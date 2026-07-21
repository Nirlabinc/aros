import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Canned = { data: unknown; error: unknown };
const tableResults = new Map<string, Canned>();
let insertCapture: Record<string, unknown> | null = null;

function builder(table: string) {
  const result = () => tableResults.get(table) ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'ilike', 'in', 'or', 'lte', 'gte', 'order', 'limit']) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = async () => result();
  chain.single = async () => result();
  chain.insert = (row: Record<string, unknown>) => { insertCapture = row; return chain; };
  chain.update = () => chain;
  chain.then = (resolve: (value: Canned) => unknown) => resolve(result());
  return chain;
}

vi.mock('../supabase.js', () => ({
  createSupabaseAdmin: () => ({
    from: (table: string) => builder(table),
    rpc: () => Promise.resolve({ data: 0, error: null }),
  }),
}));

const { handlePublicBusinessApi } = await import('../public/customer-api.js');

function mkReq(method: string, headers: Record<string, string> = {}): IncomingMessage {
  return { method, headers, socket: { remoteAddress: '203.0.113.7' }, [Symbol.asyncIterator]: async function* () {} } as unknown as IncomingMessage;
}

function mkReqBody(method: string, body: unknown): IncomingMessage {
  const payload = Buffer.from(JSON.stringify(body));
  return {
    method,
    headers: { 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.7' },
    async *[Symbol.asyncIterator]() { yield payload; },
  } as unknown as IncomingMessage;
}

function mkRes() {
  const res = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string>) {
      this.statusCode = status;
      if (headers) Object.assign(this.headers, headers);
      return this;
    },
    end(body?: string) {
      if (body) this.body = body;
      return this;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string; headers: Record<string, string> };
}

const url = (path: string) => new URL(`http://x${path}`);
const business = (slug = 'demo-market') => ({
  tenants: { data: { id: 't1', name: 'Demo Market', slug, status: 'active' }, error: null },
  stores: { data: [{ id: 's1', name: 'Demo', slug: 'main', timezone: 'America/New_York', status: 'active', metadata: { hours: { mon: '06:00-22:00' } } }], error: null },
});

function seed(map: Record<string, Canned>) {
  tableResults.clear();
  for (const [key, value] of Object.entries(map)) tableResults.set(key, value);
}

beforeEach(() => {
  tableResults.clear();
  insertCapture = null;
});

describe('public customer API - routing and contract', () => {
  it('returns false only for paths outside the prefix', async () => {
    const res = mkRes();
    const handled = await handlePublicBusinessApi(mkReq('GET'), res, url('/api/other/thing'));
    expect(handled).toBe(false);
  });

  it('near-miss under the prefix gets a terminal customer-safe refusal', async () => {
    const res = mkRes();
    const handled = await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/demo-market/orders'));
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.channel).toBe('customer');
    expect(body.refusal.code).toBe('unknown_resource');
  });

  it('unknown business is refused, never invented', async () => {
    seed({ tenants: { data: null, error: null } });
    const res = mkRes();
    await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/nope/products'));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).refusal.code).toBe('unknown_business');
  });

  it('wrong HTTP method is refused as read-only', async () => {
    seed(business());
    const res = mkRes();
    await handlePublicBusinessApi(mkReq('POST'), res, url('/api/public/businesses/demo-market/products'));
    expect(res.statusCode).toBe(405);
    expect(JSON.parse(res.body).refusal.message).toContain('Regulars is read-only');
  });

  it('synthetic demo tenant is labeled source=synthetic_demo', async () => {
    seed({ ...business('demo-market'), public_products_v: { data: [{ sku: 'COF-LG', name: 'Coffee', department: 'Hot', unit_price: 2.49, availability: 'in_stock', as_of: '2026-07-17T08:00:00Z' }], error: null } });
    const res = mkRes();
    await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/demo-market/products'));
    expect(JSON.parse(res.body).source).toBe('synthetic_demo');
  });
});

describe('public customer API - grounded read-only data', () => {
  it('products: never leaks cost or exact-stock columns', async () => {
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

  it('profile: serves approved business metadata as a read-only projection', async () => {
    seed({
      tenants: business().tenants,
      stores: {
        data: [{
          id: 's1',
          name: 'Main Store',
          slug: 'main',
          timezone: 'America/New_York',
          status: 'active',
          metadata: {
            profile: {
              name: 'Demo Market',
              category: 'Convenience store',
              phone: '+1-555-0100',
              website: 'https://regulars.aros.live/demo-market',
              address: { locality: 'Calhoun', region: 'GA' },
            },
          },
        }],
        error: null,
      },
    });
    const res = mkRes();
    await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/demo-market/profile'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).profile).toMatchObject({
      businessSlug: 'demo-market',
      name: 'Demo Market',
      category: 'Convenience store',
      readonly: true,
    });
    expect(insertCapture).toBeNull();
  });

  it('links: serves approved website, map, social, and assistant links read-only', async () => {
    seed({
      tenants: business().tenants,
      stores: {
        data: [{
          id: 's1',
          name: 'Demo',
          slug: 'main',
          timezone: 'America/New_York',
          status: 'active',
          metadata: {
            links: {
              website: 'https://demo.example',
              maps: { google: 'https://maps.google.com/?cid=123' },
              social: { instagram: 'https://instagram.com/demo' },
            },
          },
        }],
        error: null,
      },
    });
    const res = mkRes();
    await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/demo-market/links'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.links.website).toBe('https://demo.example');
    expect(body.links.maps.google).toContain('maps.google.com');
    expect(body.readonly).toBe(true);
    expect(JSON.stringify(body).toLowerCase()).not.toContain('checkout');
  });

  it('cart paths are terminally refused as unknown Regulars resources', async () => {
    seed(business());
    const res = mkRes();
    await handlePublicBusinessApi(mkReqBody('POST', { items: [{ sku: 'COF-LG', qty: 1 }] }), res, url('/api/public/businesses/demo-market/cart'));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).refusal.code).toBe('unknown_resource');
    expect(insertCapture).toBeNull();
  });

  it('hours: honest refusal when the store has not published them', async () => {
    seed({ tenants: business().tenants, stores: { data: [{ id: 's1', name: 'Demo', slug: 'main', timezone: 'UTC', status: 'active', metadata: {} }], error: null } });
    const res = mkRes();
    await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/demo-market/hours'));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).refusal.code).toBe('hours_not_published');
  });
});

describe('public customer API - abuse controls', () => {
  it('rate limiter eventually 429s a burst from one socket peer', async () => {
    seed({ ...business(), public_promotions: { data: [], error: null } });
    let sawLimit = false;
    for (let i = 0; i < 60; i++) {
      const res = mkRes();
      await handlePublicBusinessApi(mkReq('GET'), res, url('/api/public/businesses/demo-market/promotions'));
      if (res.statusCode === 429) {
        sawLimit = true;
        expect(res.headers['Retry-After']).toBeDefined();
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });
});
