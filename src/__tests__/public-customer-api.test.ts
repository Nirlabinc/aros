import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ── Controllable Supabase stub ─────────────────────────────────────────────
// Per-table canned results; every filter/order method is chainable and the
// builder is awaitable. maybeSingle/single/insert/update resolve too. Lets us
// exercise the real handler paths (refusals, envelope, store scoping, the
// review fixes) with no live DB.
type Canned = { data: unknown; error: unknown };
const tableResults = new Map<string, Canned>();
const rpcCalls: string[] = [];
let insertCapture: Record<string, unknown> | null = null;

function builder(table: string) {
  const result = () => tableResults.get(table) ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'ilike', 'in', 'or', 'lte', 'gte', 'order', 'limit']) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = async () => result();
  chain.single = async () => result();
  chain.insert = (row: Record<string, unknown>) => { insertCapture = row; return chain; };
  chain.update = () => chain;
  chain.then = (resolve: (v: Canned) => unknown) => resolve(result());
  return chain;
}

vi.mock('../supabase.js', () => ({
  createSupabaseAdmin: () => ({
    from: (t: string) => builder(t),
    rpc: (name: string) => { rpcCalls.push(name); return Promise.resolve({ data: 0, error: null }); },
  }),
}));

const { handlePublicBusinessApi } = await import('../public/customer-api.js');

// ── fake req/res ───────────────────────────────────────────────────────────
function mkReq(method: string, headers: Record<string, string> = {}): IncomingMessage {
  return { method, headers, socket: { remoteAddress: '203.0.113.7' }, [Symbol.asyncIterator]: async function* () {} } as unknown as IncomingMessage;
}
function mkReqBody(method: string, body: unknown): IncomingMessage {
  const payload = Buffer.from(JSON.stringify(body));
  return { method, headers: { 'content-type': 'application/json' }, socket: { remoteAddress: '203.0.113.7' },
    async *[Symbol.asyncIterator]() { yield payload; } } as unknown as IncomingMessage;
}
function mkRes() {
  const res = { statusCode: 0, body: '', headers: {} as Record<string, string>,
    writeHead(s: number, h?: Record<string, string>) { this.statusCode = s; if (h) Object.assign(this.headers, h); return this; },
    end(b?: string) { if (b) this.body = b; return this; } };
  return res as unknown as ServerResponse & { statusCode: number; body: string; headers: Record<string, string> };
}
const url = (p: string) => new URL(`http://x${p}`);
const business = (slug = 'demo-market') => ({
  tenants: { data: { id: 't1', slug, status: 'active' }, error: null },
  stores: { data: [{ id: 's1', name: 'Demo', slug: 'main', timezone: 'America/New_York', status: 'active', metadata: { hours: { mon: '06:00-22:00' } } }], error: null },
});
function seed(map: Record<string, Canned>) { tableResults.clear(); for (const [k, v] of Object.entries(map)) tableResults.set(k, v); }

beforeEach(() => { tableResults.clear(); rpcCalls.length = 0; insertCapture = null; });

describe('public customer API — routing & contract', () => {
  it('returns false only for paths outside the prefix', async () => {
    const res = mkRes();
    const handled = await handlePublicBusinessApi(mkReq('GET'), res, url('/api/other/thing'));
    expect(handled).toBe(false);
  });

  it('near-miss under the prefix gets a terminal customer-safe refusal (no fallthrough)', async () => {
    const res = mkRes();
    const handled = await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/demo-market/orders'));
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
    const b = JSON.parse(res.body);
    expect(b.channel).toBe('customer');
    expect(b.refusal.code).toBe('unknown_resource');
  });

  it('unknown business is refused, never invented', async () => {
    seed({ tenants: { data: null, error: null } });
    const res = mkRes();
    await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/nope/products'));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).refusal.code).toBe('unknown_business');
  });

  it('wrong HTTP method is refused', async () => {
    seed(business());
    const res = mkRes();
    await handlePublicBusinessApi(mkReq('POST'), res, url('/api/public/businesses/demo-market/products'));
    expect(res.statusCode).toBe(405);
  });

  it('synthetic demo tenant is labeled source=synthetic_demo', async () => {
    seed({ ...business('demo-market'), public_products_v: { data: [{ sku: 'COF-LG', name: 'Coffee', department: 'Hot', unit_price: 2.49, availability: 'in_stock', as_of: '2026-07-17T08:00:00Z' }], error: null } });
    const res = mkRes();
    await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/demo-market/products'));
    expect(JSON.parse(res.body).source).toBe('synthetic_demo');
  });
});

describe('public customer API — grounding & the review fixes', () => {
  it('products: never leaks cost/exact-stock columns', async () => {
    seed({ ...business(), public_products_v: { data: [{ sku: 'COF-LG', name: 'Coffee', department: 'Hot', unit_price: 2.49, availability: 'in_stock', as_of: '2026-07-17T08:00:00Z' }], error: null } });
    const res = mkRes();
    await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/demo-market/products?q=cof'));
    expect(res.body).not.toMatch(/unit_cost|units_on_hand|inventory_value|"cost"/);
    expect(JSON.parse(res.body).products[0].availability).toBe('in_stock');
  });

  it('products: DB error surfaces as 502, not a false empty answer', async () => {
    seed({ ...business(), public_products_v: { data: null, error: { message: 'boom' } } });
    const res = mkRes();
    await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/demo-market/products'));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).refusal.code).toBe('projection_unavailable');
  });

  it('cart: DB error → 502, not a false "unknown_items" (review fix)', async () => {
    seed({ ...business(), public_products_v: { data: null, error: { message: 'outage' } } });
    const res = mkRes();
    await handlePublicBusinessApi(mkReqBody('POST', { items: [{ sku: 'COF-LG', qty: 1 }] }), res, url('/api/public/businesses/demo-market/cart'));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).refusal.code).toBe('projection_unavailable');
  });

  it('cart: out-of-stock item refused with 409, not drafted (review fix)', async () => {
    seed({ ...business(), public_products_v: { data: [{ sku: 'CHP-REG', name: 'Chips', unit_price: 1.99, availability: 'unavailable' }], error: null } });
    const res = mkRes();
    await handlePublicBusinessApi(mkReqBody('POST', { items: [{ sku: 'CHP-REG', qty: 1 }] }), res, url('/api/public/businesses/demo-market/cart'));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).refusal.code).toBe('items_unavailable');
  });

  it('cart: prices server-side and purges expired drafts best-effort', async () => {
    seed({ ...business(),
      public_products_v: { data: [{ sku: 'COF-LG', name: 'Coffee', unit_price: 2.49, availability: 'in_stock' }], error: null },
      public_cart_drafts: { data: { id: 'cart1', expires_at: '2026-07-18T08:00:00Z' }, error: null } });
    const res = mkRes();
    await handlePublicBusinessApi(mkReqBody('POST', { items: [{ sku: 'COF-LG', qty: 3 }] }), res, url('/api/public/businesses/demo-market/cart'));
    expect(res.statusCode).toBe(201);
    const b = JSON.parse(res.body);
    expect(b.cart.subtotal).toBe(7.47); // 2.49 * 3, priced from the projection not the client
    expect(rpcCalls).toContain('purge_expired_cart_drafts');
  });

  it('hours: honest refusal when the store has not published them', async () => {
    seed({ tenants: business().tenants, stores: { data: [{ id: 's1', name: 'Demo', slug: 'main', timezone: 'UTC', status: 'active', metadata: {} }], error: null } });
    const res = mkRes();
    await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/demo-market/hours'));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).refusal.code).toBe('hours_not_published');
  });
});

describe('public customer API — abuse controls', () => {
  it('rate limiter eventually 429s a burst from one socket peer', async () => {
    seed({ ...business(), public_promotions: { data: [], error: null } });
    let sawLimit = false;
    for (let i = 0; i < 60; i++) {
      const res = mkRes();
      await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/demo-market/promotions'));
      if (res.statusCode === 429) { sawLimit = true; expect(res.headers['Retry-After']).toBeDefined(); break; }
    }
    expect(sawLimit).toBe(true);
  });
});
