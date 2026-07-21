// Regulars Phase 1 — customer-safe public commerce API.
// Serves /api/public/businesses/{slug}/(profile|products|promotions|hours|links)
// for the Regulars customer MCP gateway (apps/mcp-aros). Unauthenticated
// read-only projection: every response is grounded in rows (stores.metadata /
// public_products_v / public_promotions) or is a structured refusal — never
// invented. Regulars must not mutate business data, carts, orders, payments,
// POS systems, connector state, or external pages.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createSupabaseAdmin } from '../supabase.js';

const MAX_RESULTS = 25;
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

type Business = { tenantId: string; tenantName: string; storeId: string; storeName: string; timezone: string; metadata: Record<string, unknown> };

async function resolveBusiness(slug: string, storeSlug: string | null): Promise<Business | null> {
  const supabase = createSupabaseAdmin();
  const { data: tenant } = await supabase
    .from('tenants').select('id, name, slug, status').eq('slug', slug).eq('status', 'active').maybeSingle();
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
    tenantId: tenant.id, tenantName: tenant.name ?? store.name, storeId: store.id, storeName: store.name,
    timezone: store.timezone ?? 'America/New_York',
    metadata: (store.metadata ?? {}) as Record<string, unknown>,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function listStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function demoProducts(query: string, limit: number) {
  const products = [
    { sku: 'COF-LG', name: 'Large Coffee', department: 'Hot Beverages', price: 2.49, availability: 'in_stock' },
    { sku: 'BAN-01', name: 'Banana', department: 'Produce', price: 0.79, availability: 'in_stock' },
    { sku: 'H2O-24', name: 'Spring Water 24pk', department: 'Beverages', price: 5.99, availability: 'in_stock' },
    { sku: 'ENR-16', name: 'Energy Drink 16oz', department: 'Beverages', price: 2.99, availability: 'low_stock' },
    { sku: 'SND-BLT', name: 'BLT Sandwich', department: 'Deli', price: 5.49, availability: 'in_stock' },
    { sku: 'CHP-REG', name: 'Potato Chips', department: 'Snacks', price: 1.99, availability: 'unavailable' },
    { sku: 'MLK-OAT', name: 'Oat Milk Quart', department: 'Dairy Alt', price: 4.29, availability: 'in_stock' },
    { sku: 'ICE-10', name: 'Ice Bag 10lb', department: 'Frozen', price: 2.49, availability: 'in_stock' },
  ];
  const needle = query.toLowerCase();
  return products
    .filter((product) => !needle || product.name.toLowerCase().includes(needle) || product.department.toLowerCase().includes(needle))
    .slice(0, limit);
}

function demoPromotions() {
  return [
    {
      id: 'dd000000-0000-4000-8000-000000000011',
      title: '2 energy drinks for $5',
      description: 'Any two 16oz energy drinks',
      kind: 'offer',
      sponsored: true,
      startsAt: '2026-07-21T00:00:00Z',
      endsAt: '2026-08-31T00:00:00Z',
    },
    {
      id: 'dd000000-0000-4000-8000-000000000012',
      title: 'Free banana with any coffee',
      description: 'Auto-applies at the register',
      kind: 'offer',
      sponsored: false,
      startsAt: '2026-07-21T00:00:00Z',
      endsAt: null,
    },
  ];
}

// ── endpoint handlers ──────────────────────────────────────────────────────

async function handleProfile(res: ServerResponse, biz: Business, slug: string, correlationId: string): Promise<void> {
  const profile = record(biz.metadata.profile);
  const address = record(profile.address ?? biz.metadata.address);
  const category = stringOrNull(profile.category) ?? stringOrNull(biz.metadata.category);
  send(res, 200, {
    ...envelope(slug, correlationId),
    profile: {
      businessSlug: slug,
      name: stringOrNull(profile.name) ?? biz.tenantName,
      store: { id: biz.storeId, name: biz.storeName, timezone: biz.timezone },
      category,
      phone: stringOrNull(profile.phone) ?? stringOrNull(biz.metadata.phone),
      website: stringOrNull(profile.website) ?? stringOrNull(biz.metadata.website),
      address,
      serviceArea: record(profile.serviceArea ?? biz.metadata.serviceArea),
      readonly: true,
    },
  });
}

async function handleProducts(res: ServerResponse, biz: Business, slug: string, url: URL, correlationId: string): Promise<void> {
  const supabase = createSupabaseAdmin();
  const query = (url.searchParams.get('q') ?? url.searchParams.get('query') ?? '').trim();
  const limit = Math.max(1, Math.min(Math.floor(Number(url.searchParams.get('limit')) || 10), MAX_RESULTS));
  let sel = supabase.from('public_products_v')
    .select('sku, name, department, unit_price, availability, as_of')
    .eq('store_id', biz.storeId).limit(limit);
  if (query) sel = sel.ilike('name', `%${query}%`);
  const { data, error } = await sel;
  if (error && SYNTHETIC_SLUGS.has(slug)) {
    const products = demoProducts(query, limit);
    if (products.length === 0) {
      return refuse(res, 404, slug, correlationId, 'no_matching_products',
        query ? `This store's catalog doesn't list anything matching "${query}".` : 'No catalog data is available for this store yet.');
    }
    send(res, 200, { ...envelope(slug, correlationId), products });
    return;
  }
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
  if (error && SYNTHETIC_SLUGS.has(slug)) {
    send(res, 200, { ...envelope(slug, correlationId), promotions: demoPromotions() });
    return;
  }
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

async function handleLinks(res: ServerResponse, biz: Business, slug: string, correlationId: string): Promise<void> {
  const profile = record(biz.metadata.profile);
  const links = record(profile.links ?? biz.metadata.links);
  const social = record(profile.social ?? biz.metadata.social);
  const website = stringOrNull(links.website) ?? stringOrNull(profile.website) ?? stringOrNull(biz.metadata.website);
  send(res, 200, {
    ...envelope(slug, correlationId),
    links: {
      website,
      maps: record(links.maps),
      social,
      assistantInstall: {
        chatgpt: stringOrNull(links.chatgpt) ?? `https://regulars.aros.live/${slug}/connect/chatgpt`,
        claude: stringOrNull(links.claude) ?? `https://regulars.aros.live/${slug}/connect/claude`,
      },
      support: stringOrNull(links.support),
      legal: listStrings(links.legal),
    },
    readonly: true,
  });
}

// ── router entry: TERMINAL for the whole /api/public/businesses/ prefix ────
// Returns false only when the path is not under the prefix at all. Anything
// under the prefix gets a customer-safe envelope+refusal response — a
// near-miss (trailing slash, uppercase slug, unknown resource) must never
// fall through to the platform's generic 404/SPA output, which the gateway
// would relay as non-customer-safe.
const PREFIX = '/api/public/businesses/';
const ROUTE = /^\/api\/public\/businesses\/([a-z0-9-]{1,64})\/(profile|products|promotions|hours|links)$/;

export async function handlePublicBusinessApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith(PREFIX)) return false;
  // Normalize a single trailing slash and lowercase the slug segment before matching.
  const normalized = url.pathname.replace(/\/+$/, (m) => (m.length ? '' : m)).toLowerCase();
  const match = ROUTE.exec(normalized);
  const correlationId0 = (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID();
  if (!match) {
    const slugGuess = normalized.slice(PREFIX.length).split('/')[0] || 'unknown';
    refuse(res, 404, slugGuess, correlationId0, 'unknown_resource',
      'That is not a valid Regulars endpoint. Use /profile, /products, /promotions, /hours, or /links for a business.');
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

  if (req.method !== 'GET') {
    refuse(res, 405, slug, correlationId, 'method_not_allowed', `Regulars is read-only. Use GET for ${resource}.`);
    return true;
  }

  try {
    const biz = await resolveBusiness(slug, url.searchParams.get('store'));
    if (!biz) {
      refuse(res, 404, slug, correlationId, 'unknown_business', `No business called "${slug}" is available here.`);
      emitEvent({ resource, slug, status: 404, ms: Date.now() - started, correlationId });
      return true;
    }
    if (resource === 'profile') await handleProfile(res, biz, slug, correlationId);
    else if (resource === 'products') await handleProducts(res, biz, slug, url, correlationId);
    else if (resource === 'promotions') await handlePromotions(res, biz, slug, correlationId);
    else if (resource === 'hours') await handleHours(res, biz, slug, correlationId);
    else await handleLinks(res, biz, slug, correlationId);
    emitEvent({ resource, slug, status: res.statusCode, ms: Date.now() - started, correlationId });
  } catch (err) {
    console.error('[public-api]', resource, slug, err instanceof Error ? err.message : err);
    refuse(res, 502, slug, correlationId, 'internal_error', 'Something went wrong answering that — try again.');
    emitEvent({ resource, slug, status: 502, ms: Date.now() - started, correlationId });
  }
  return true;
}
