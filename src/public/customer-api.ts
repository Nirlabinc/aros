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

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
  return (first ?? req.socket.remoteAddress ?? 'unknown').trim();
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
  const limit = Math.min(Number(url.searchParams.get('limit')) || 10, MAX_RESULTS);
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
  const skus = items.map((i) => String(i.sku ?? '')).filter(Boolean);
  const { data: rows } = await supabase.from('public_products_v')
    .select('sku, name, unit_price, availability')
    .eq('store_id', biz.storeId).in('sku', skus);
  const bySku = new Map((rows ?? []).map((r) => [r.sku as string, r]));
  const missing = skus.filter((s) => !bySku.has(s));
  if (missing.length > 0) {
    return refuse(res, 404, slug, correlationId, 'unknown_items', `Not in this store's catalog: ${missing.join(', ')}.`);
  }
  const priced = items.map((i) => {
    const row = bySku.get(String(i.sku))!;
    const qty = Math.max(1, Math.min(99, Number(i.qty) || 1));
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
  const { data: cart } = await supabase.from('public_cart_drafts')
    .select('id, items, subtotal, status, expires_at')
    .eq('id', cartId).eq('tenant_id', biz.tenantId).maybeSingle();
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

// ── router entry: returns true when the request was handled ────────────────
const ROUTE = /^\/api\/public\/businesses\/([a-z0-9-]{1,64})\/(products|promotions|hours|cart|checkout)$/;

export async function handlePublicBusinessApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const match = ROUTE.exec(url.pathname);
  if (!match) return false;
  const [, slug, resource] = match;
  const correlationId = (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID();
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
