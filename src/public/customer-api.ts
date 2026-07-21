// Regulars Phase 1 — customer-safe public commerce API.
// Serves /api/public/businesses/{slug}/(products|promotions|hours|cart|checkout)
// for the customer MCP gateway (apps/mcp-aros). Unauthenticated public
// projection: every response is grounded in rows (public_products_v /
// public_promotions / stores.metadata) or is a structured refusal — never
// invented. Mission contract: Nirpat3/regulars docs/missions/regulars-phase1.md
// Journey spec: docs/journeys/customer-orders-through-their-assistant.md

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createSupabaseAdmin } from '../supabase.js';

const MAX_RESULTS = 25;
const CART_MAX_ITEMS = 20;
const SYNTHETIC_SLUGS = new Set(['demo-market']);

// ── rate limiting: token bucket per client IP (public surface must never ship unthrottled) ──
const RATE_CAPACITY = 30;          // burst
const RATE_REFILL_PER_SEC = 1;     // sustained 60/min
const buckets = new Map<string, { tokens: number; last: number }>();

function allowRequest(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: RATE_CAPACITY, last: now };
  b.tokens = Math.min(RATE_CAPACITY, b.tokens + ((now - b.last) / 1000) * RATE_REFILL_PER_SEC);
  b.last = now;
  if (b.tokens < 1) { buckets.set(ip, b); return false; }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}
// Bound memory: drop stale buckets occasionally.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [ip, b] of buckets) if (b.last < cutoff) buckets.delete(ip);
}, 60 * 1000).unref?.();

// Rate-limit key. x-forwarded-for is client-controllable at its LEFT end
// (each proxy APPENDS the peer it saw), so the leftmost hop is spoofable and
// must never be the key. TRUSTED_PROXY_HOPS = how many proxies sit in front of
// this process (Cloudflare tunnel + nginx = 2); we take the hop that many
// positions from the RIGHT — the address our own edge observed. Default 0 =
// trust nothing and key on the real TCP peer (socket.remoteAddress), which
// cannot be spoofed. Operator sets the hop count to match the deployment.
const TRUSTED_PROXY_HOPS = Math.max(0, Number(process.env.PUBLIC_API_TRUSTED_PROXY_HOPS) || 0);

function clientIp(req: IncomingMessage): string {
  const socketIp = req.socket.remoteAddress ?? 'unknown';
  if (TRUSTED_PROXY_HOPS === 0) return socketIp;
  const raw = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(raw) ? raw.join(',') : raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  // The hop TRUSTED_PROXY_HOPS from the end is the client as seen by our
  // outermost trusted proxy; anything further left is attacker-appendable.
  const idx = chain.length - TRUSTED_PROXY_HOPS;
  return chain[idx] ?? chain[0] ?? socketIp;
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>, extra?: Record<string, string>): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(body));
}

type Envelope = {
  businessSlug: string;
  channel: 'customer';
  source: 'public_projection' | 'synthetic_demo';
  asOf: string;
  correlationId: string;
};

function envelope(slug: string, correlationId: string, asOf?: string): Envelope {
  return {
    businessSlug: slug,
    channel: 'customer',
    source: SYNTHETIC_SLUGS.has(slug) ? 'synthetic_demo' : 'public_projection',
    asOf: asOf ?? new Date().toISOString(),
    correlationId,
  };
}

/** Structured refusal — the honest-gap contract. Never fabricate. */
function refuse(res: ServerResponse, status: number, slug: string, correlationId: string, code: string, message: string): void {
  send(res, status, { ...envelope(slug, correlationId), refusal: { code, message } });
}

function emitEvent(event: Record<string, unknown>): void {
  // Analytics seam (task #8): structured log line, collected downstream.
  console.log(JSON.stringify({ evt: 'public_api', ts: new Date().toISOString(), ...event }));
}

type Business = { tenantId: string; storeId: string; storeName: string; timezone: string; metadata: Record<string, unknown> };

async function resolveBusiness(slug: string, storeSlug: string | null): Promise<Business | null> {
  const supabase = createSupabaseAdmin();
  const { data: tenant } = await supabase
    .from('tenants').select('id, slug, status').eq('slug', slug).eq('status', 'active').maybeSingle();
  if (!tenant) return null;
  let q = supabase.from('stores')
    .select('id, name, slug, timezone, status, metadata')
    .eq('tenant_id', tenant.id).eq('status', 'active')
    .order('created_at', { ascending: true }).limit(1);
  if (storeSlug) q = supabase.from('stores')
    .select('id, name, slug, timezone, status, metadata')
    .eq('tenant_id', tenant.id).eq('status', 'active').eq('slug', storeSlug).limit(1);
  const { data: stores } = await q;
  const store = stores?.[0];
  if (!store) return null;
  return {
    tenantId: tenant.id, storeId: store.id, storeName: store.name,
    timezone: store.timezone ?? 'America/New_York',
    metadata: (store.metadata ?? {}) as Record<string, unknown>,
  };
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  try {
    const chunks: Buffer[] = [];
    for await (const c of req) { chunks.push(c as Buffer); if (chunks.reduce((n, b) => n + b.length, 0) > 64_000) return null; }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch { return null; }
}

// ── endpoint handlers ──────────────────────────────────────────────────────

async function handleProducts(res: ServerResponse, biz: Business, slug: string, url: URL, correlationId: string): Promise<void> {
  const supabase = createSupabaseAdmin();
  const query = (url.searchParams.get('q') ?? url.searchParams.get('query') ?? '').trim();
  const limit = Math.max(1, Math.min(Math.floor(Number(url.searchParams.get('limit')) || 10), MAX_RESULTS));
  let sel = supabase.from('public_products_v')
    .select('sku, name, department, unit_price, availability, as_of')
    .eq('store_id', biz.storeId).limit(limit);
  if (query) sel = sel.ilike('name', `%${query}%`);
  const { data, error } = await sel;
  if (error) return refuse(res, 502, slug, correlationId, 'projection_unavailable', 'The product projection is temporarily unavailable.');
  if (!data || data.length === 0) {
    return refuse(res, 404, slug, correlationId, 'no_matching_products',
      query ? `This store's catalog doesn't list anything matching "${query}".` : 'No catalog data is available for this store yet.');
  }
  const asOf = data[0]?.as_of as string | undefined;
  send(res, 200, {
    ...envelope(slug, correlationId, asOf),
    products: data.map((r) => ({ sku: r.sku, name: r.name, department: r.department, price: Number(r.unit_price), availability: r.availability })),
  });
}

async function handlePromotions(res: ServerResponse, biz: Business, slug: string, correlationId: string): Promise<void> {
  const supabase = createSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from('public_promotions')
    .select('id, title, description, kind, sponsored, starts_at, ends_at')
    .eq('tenant_id', biz.tenantId).eq('status', 'active')
    // store_id null = all locations; a specific id = that store only. Never
    // surface another location's promotion for the store the customer asked about.
    .or(`store_id.is.null,store_id.eq.${biz.storeId}`)
    .lte('starts_at', nowIso)
    .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
    .order('sponsored', { ascending: false })
    .limit(MAX_RESULTS);
  if (error) return refuse(res, 502, slug, correlationId, 'projection_unavailable', 'Promotions are temporarily unavailable.');
  send(res, 200, {
    ...envelope(slug, correlationId),
    promotions: (data ?? []).map((p) => ({
      id: p.id, title: p.title, description: p.description, kind: p.kind,
      sponsored: Boolean(p.sponsored), startsAt: p.starts_at, endsAt: p.ends_at,
    })),
    note: (data ?? []).length === 0 ? 'No promotions running right now.' : undefined,
  });
}

async function handleHours(res: ServerResponse, biz: Business, slug: string, correlationId: string): Promise<void> {
  const hours = (biz.metadata as { hours?: Record<string, string> }).hours;
  if (!hours || Object.keys(hours).length === 0) {
    return refuse(res, 404, slug, correlationId, 'hours_not_published', 'This store has not published its hours yet.');
  }
  send(res, 200, { ...envelope(slug, correlationId), store: biz.storeName, timezone: biz.timezone, hours });
}

async function handleCart(req: IncomingMessage, res: ServerResponse, biz: Business, slug: string, correlationId: string): Promise<void> {
  const body = await readBody(req);
  const items = Array.isArray(body?.items) ? (body!.items as Array<{ sku?: unknown; qty?: unknown }>) : null;
  if (!items || items.length === 0 || items.length > CART_MAX_ITEMS) {
    return refuse(res, 400, slug, correlationId, 'invalid_cart', `Provide 1-${CART_MAX_ITEMS} items as [{sku, qty}].`);
  }
  const supabase = createSupabaseAdmin();
  // Best-effort purge of expired drafts to bound growth from this public path.
  supabase.rpc('purge_expired_cart_drafts').then(() => {}, () => {});
  const skus = items.map((i) => String(i.sku ?? '')).filter(Boolean);
  const { data: rows, error: lookupError } = await supabase.from('public_products_v')
    .select('sku, name, unit_price, availability')
    .eq('store_id', biz.storeId).in('sku', skus);
  // A DB/projection error must surface as an outage, never a false "not in catalog".
  if (lookupError) return refuse(res, 502, slug, correlationId, 'projection_unavailable', 'The product projection is temporarily unavailable.');
  const bySku = new Map((rows ?? []).map((r) => [r.sku as string, r]));
  const missing = skus.filter((s) => !bySku.has(s));
  if (missing.length > 0) {
    return refuse(res, 404, slug, correlationId, 'unknown_items', `Not in this store's catalog: ${missing.join(', ')}.`);
  }
  const unavailable = skus.filter((s) => bySku.get(s)?.availability === 'unavailable');
  if (unavailable.length > 0) {
    return refuse(res, 409, slug, correlationId, 'items_unavailable',
      `Out of stock at this store: ${unavailable.map((s) => bySku.get(s)?.name ?? s).join(', ')}.`);
  }
  const priced = items.map((i) => {
    const row = bySku.get(String(i.sku))!;
    const qty = Math.max(1, Math.min(99, Math.floor(Number(i.qty) || 1)));
    return { sku: row.sku, name: row.name, qty, unit_price: Number(row.unit_price), availability: row.availability };
  });
  const subtotal = Math.round(priced.reduce((n, i) => n + i.unit_price * i.qty, 0) * 100) / 100;
  const { data: cart, error } = await supabase.from('public_cart_drafts')
    .insert({ tenant_id: biz.tenantId, store_id: biz.storeId, items: priced, subtotal, status: 'draft', correlation_id: correlationId })
    .select('id, expires_at').single();
  if (error || !cart) return refuse(res, 502, slug, correlationId, 'cart_unavailable', 'Could not create a cart draft right now.');
  send(res, 201, {
    ...envelope(slug, correlationId),
    cart: { cartId: cart.id, items: priced, subtotal, status: 'draft', expiresAt: cart.expires_at },
    note: 'Draft only — payment is completed at pickup in this phase.',
  });
}

async function handleCheckout(req: IncomingMessage, res: ServerResponse, biz: Business, slug: string, correlationId: string): Promise<void> {
  const body = await readBody(req);
  const cartId = String(body?.cartId ?? '');
  if (!cartId) return refuse(res, 400, slug, correlationId, 'invalid_checkout', 'Provide the cartId to check out.');
  const supabase = createSupabaseAdmin();
  // Scope by store, not just tenant — a cart drafted at store A must not be
  // checked out under store B of the same tenant (wrong prices/location).
  const { data: cart, error: cartError } = await supabase.from('public_cart_drafts')
    .select('id, items, subtotal, status, expires_at')
    .eq('id', cartId).eq('tenant_id', biz.tenantId).eq('store_id', biz.storeId).maybeSingle();
  if (cartError) return refuse(res, 502, slug, correlationId, 'checkout_unavailable', 'Could not look up that cart right now.');
  if (!cart) return refuse(res, 404, slug, correlationId, 'unknown_cart', 'That cart draft does not exist for this store.');
  if (cart.status === 'expired' || new Date(String(cart.expires_at)) < new Date()) {
    return refuse(res, 410, slug, correlationId, 'cart_expired', 'That cart draft has expired — start a new one.');
  }
  const { error } = await supabase.from('public_cart_drafts')
    .update({ status: 'checkout_draft' }).eq('id', cartId);
  if (error) return refuse(res, 502, slug, correlationId, 'checkout_unavailable', 'Could not create the checkout draft right now.');
  send(res, 200, {
    ...envelope(slug, correlationId),
    checkout: { checkoutDraftId: cart.id, subtotal: Number(cart.subtotal), status: 'checkout_draft', payment: 'not_enabled_in_phase_1' },
    note: 'Order drafted. In-chat payment is not yet enabled — pay at pickup to complete it.',
  });
}

// ── router entry: TERMINAL for the whole /api/public/businesses/ prefix ────
// Returns false only when the path is not under the prefix at all. Anything
// under the prefix gets a customer-safe envelope+refusal response — a
// near-miss (trailing slash, uppercase slug, unknown resource) must never
// fall through to the platform's generic 404/SPA output, which the gateway
// would relay as non-customer-safe.
const PREFIX = '/api/public/businesses/';
const ROUTE = /^\/api\/public\/businesses\/([a-z0-9-]{1,64})\/(products|promotions|hours|cart|checkout)$/;

export async function handlePublicBusinessApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith(PREFIX)) return false;
  // Normalize a single trailing slash and lowercase the slug segment before matching.
  const normalized = url.pathname.replace(/\/+$/, (m) => (m.length ? '' : m)).toLowerCase();
  const match = ROUTE.exec(normalized);
  const correlationId0 = (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID();
  if (!match) {
    const slugGuess = normalized.slice(PREFIX.length).split('/')[0] || 'unknown';
    refuse(res, 404, slugGuess, correlationId0, 'unknown_resource',
      'That is not a valid customer endpoint. Use /products, /promotions, /hours, /cart, or /checkout for a business.');
    return true;
  }
  const [, slug, resource] = match;
  const correlationId = correlationId0;
  const started = Date.now();
  const ip = clientIp(req);

  if (!allowRequest(ip)) {
    send(res, 429, { ...envelope(slug, correlationId), refusal: { code: 'rate_limited', message: 'Too many requests — slow down.' } }, { 'Retry-After': '30' });
    emitEvent({ resource, slug, status: 429, ms: Date.now() - started, correlationId });
    return true;
  }

  const isWrite = resource === 'cart' || resource === 'checkout';
  if ((isWrite && req.method !== 'POST') || (!isWrite && req.method !== 'GET')) {
    refuse(res, 405, slug, correlationId, 'method_not_allowed', `Use ${isWrite ? 'POST' : 'GET'} for ${resource}.`);
    return true;
  }

  try {
    const biz = await resolveBusiness(slug, url.searchParams.get('store'));
    if (!biz) {
      refuse(res, 404, slug, correlationId, 'unknown_business', `No business called "${slug}" is available here.`);
      emitEvent({ resource, slug, status: 404, ms: Date.now() - started, correlationId });
      return true;
    }
    if (resource === 'products') await handleProducts(res, biz, slug, url, correlationId);
    else if (resource === 'promotions') await handlePromotions(res, biz, slug, correlationId);
    else if (resource === 'hours') await handleHours(res, biz, slug, correlationId);
    else if (resource === 'cart') await handleCart(req, res, biz, slug, correlationId);
    else await handleCheckout(req, res, biz, slug, correlationId);
    emitEvent({ resource, slug, status: res.statusCode, ms: Date.now() - started, correlationId });
  } catch (err) {
    console.error('[public-api]', resource, slug, err instanceof Error ? err.message : err);
    refuse(res, 502, slug, correlationId, 'internal_error', 'Something went wrong answering that — try again.');
    emitEvent({ resource, slug, status: 502, ms: Date.now() - started, correlationId });
  }
  return true;
}
