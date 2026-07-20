/**
 * AROS Platform — Health Server + Billing API + Signup + Onboarding
 *
 * Lightweight HTTP server providing /health, /readyz, billing, signup,
 * onboarding, marketplace, and email verification endpoints.
 * Uses Node built-in http module to avoid adding dependencies.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import {
  createCheckoutSession,
  createPortalSession,
  getSubscription,
  type PlanId,
} from './billing/stripe.js';
import { handleStripeWebhook } from './billing/webhook.js';
import { provisionLicense } from './billing/license.js';
import { listTasks } from '../tasks/store.js';
import { createSupabaseAdmin } from './supabase.js';
import { createTermsModule } from './terms/gate.js';
import { createEventBus } from 'shre-sdk/events';
import { createHeartbeatMonitor } from 'shre-sdk/heartbeat';
import {
  createTraceMiddleware,
  getRecentTraces,
  getRecentFailures,
  getTraceStats,
} from 'shre-sdk/trace';
import {
  activateAllHumanConnectors,
  buildHumanLayerSnapshot,
  getHumanConnectors,
} from './human-layer.js';
import {
  createHumanGoal,
  createHumanProject,
  listHumanGoals,
  listHumanProjects,
} from './human-state.js';
import { createTask } from '../tasks/store.js';
import type { TaskPriority } from '../tasks/types.js';
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { DEFAULT_MODEL } from './model-defaults.js';
import { testConnection as testRapidRmsConnector } from '../connectors/rapidrms-api.js';
import { testConnection as testAzureDbConnector } from '../connectors/azure-db.js';
import { testConnection as testVerifoneConnector } from '../connectors/verifone/connector.js';
import { setTenantSecret, storeCredential, deleteCredential } from '../connectors/vault-ref.js';
import type { RapidRmsSession } from '../connectors/types.js';
import {
  buildEdiSession,
  resolveEdiBaseUrl,
  listEdiFiles,
  uploadEdi,
  getEdiItems,
  revertEdi,
} from '../connectors/rapidrms-edi.js';
import { fetchStoreSalesRange, fetchStoreSummary, hasSummaryMapper, type StoreSummary } from '../connectors/data-service.js';
import { replicateSnapshotToCortex } from '../connectors/cortex-bridge.js';
import { proxyToMib } from '../connectors/mib-documents.js';
import { encryptValue, decryptValue, setEncryptionKey } from '../security/input-handler.js';
import { handleEdgeRequest } from './edge/http.js';
import { handleEdgeProvisioningRequest } from './edge/provisioning-http.js';
import { EdgeProvisioningService } from './edge/provisioning.js';
import { SupabaseEdgeProvisioningRepository } from './edge/supabase-provisioning-repository.js';
import { createOidcRelyingParty } from './auth/oidc-rp.js';
import { DEFAULT_SHRE_ID_PROJECT_ID, resolveBundle } from './auth/role-bundle.js';
import { createMemoryOidcStore, createSupabaseOidcStore } from './auth/oidc-store.js';

const PORT = Number(process.env.PORT || 5457);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
const startedAt = new Date().toISOString();
const SHRE_METER_URL = process.env.SHRE_METER_URL || 'http://127.0.0.1:5495';
const SHRE_TASKS_URL = process.env.SHRE_TASKS_URL || 'http://127.0.0.1:5460';
const SHRE_ROUTER_URL = process.env.SHRE_ROUTER_URL || 'http://127.0.0.1:5497';
// Router service passport — the launch.sh-managed shre-router enforces
// passport auth on /v1/chat (cost/tenant accounting), but browser requests
// arrive at this proxy with no bearer. Mint a SERVICE passport at boot and
// refresh it periodically; proxyRequest attaches it to /v1 traffic that
// carries no Authorization of its own. Inert unless BOTH env vars are set
// (the legacy pm2 router needs neither). All anonymous traffic accounts to
// the 'aros-platform' service identity until per-session passports land
// (identity-edge lane) — at that point remove this and the router's
// /v1/chat PUBLIC_ROUTES entry together.
const SHRE_PASSPORT_URL = process.env.SHRE_PASSPORT_URL || '';
const PASSPORT_ADMIN_TOKEN = process.env.PASSPORT_ADMIN_TOKEN || '';
let routerPassportToken = '';
async function refreshRouterPassport(): Promise<void> {
  if (!SHRE_PASSPORT_URL || !PASSPORT_ADMIN_TOKEN) return;
  try {
    const res = await fetch(`${SHRE_PASSPORT_URL}/v1/passport/issue`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${PASSPORT_ADMIN_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'SERVICE',
        entityId: 'aros-platform',
        scopes: ['chat'],
        ttlSeconds: 7200,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { token?: string };
      if (data.token) routerPassportToken = data.token;
    } else {
      console.error(`[router-passport] issue failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('[router-passport] issue error:', (err as Error).message);
  }
}
if (SHRE_PASSPORT_URL && PASSPORT_ADMIN_TOKEN) {
  void refreshRouterPassport();
  setInterval(() => void refreshRouterPassport(), 30 * 60 * 1000).unref();
}
// shre-rapidrms live-server — the canonical warehouse's API (owner digest,
// gold views). Same convention as the other SHRE_*_URL upstreams above.
const SHRE_RAPIDRMS_URL = process.env.SHRE_RAPIDRMS_URL || 'http://127.0.0.1:5443';
// Service token for the warehouse digest API (live-server session gate has a
// scoped /api/digest/* bypass for machine consumers — shreai#1017). Optional:
// without it, deploys without a session gate still work.
const SHRE_RAPIDRMS_TOKEN = process.env.SHRE_RAPIDRMS_TOKEN || '';
const digestHeaders = (extra: Record<string, string> = {}): Record<string, string> =>
  SHRE_RAPIDRMS_TOKEN ? { ...extra, 'x-service-token': SHRE_RAPIDRMS_TOKEN } : extra;
const WEB_DIST = process.env.AROS_WEB_DIST || join(process.cwd(), 'apps', 'web', 'dist');

// ── Platform Integrations ────────────────────────────────────────
const eventBus = createEventBus('aros-platform');
const heartbeat = createHeartbeatMonitor('aros-platform', {
  intervalMs: 30_000,
  publishFn: (event, severity, data) => eventBus.publish(event, severity, data),
});
heartbeat.registerDependency('cortexdb', 'http://127.0.0.1:5400/health/live');
heartbeat.registerDependency('redis', 'redis://127.0.0.1:6379');
heartbeat.registerDependency('shre-tasks', 'http://127.0.0.1:5460/health');

const traceMiddleware = createTraceMiddleware('aros-platform');
const oidcStoreMode = process.env.OIDC_STORE_MODE || (process.env.NODE_ENV === 'production' ? 'supabase' : 'memory');
if (process.env.NODE_ENV === 'production' && oidcStoreMode !== 'supabase') throw new Error('Production OIDC requires OIDC_STORE_MODE=supabase');
const oidcEnvelopeKey = process.env.AROS_OIDC_ENCRYPTION_KEY || process.env.AROS_ENCRYPTION_KEY;
if (oidcStoreMode === 'supabase' && !oidcEnvelopeKey) throw new Error('Durable OIDC requires AROS_OIDC_ENCRYPTION_KEY from the secrets vault');
if (oidcEnvelopeKey) setEncryptionKey(createHash('sha256').update(oidcEnvelopeKey).digest());
const oidcStore = oidcStoreMode === 'supabase' ? createSupabaseOidcStore(createSupabaseAdmin(), { seal: encryptValue, open: decryptValue }) : createMemoryOidcStore();
try { await oidcStore.cleanup(Date.now()); } catch (error) { if (process.env.NODE_ENV === 'production') throw new Error(`Durable OIDC store unavailable: ${error instanceof Error ? error.message : String(error)}`); }
const oidcCleanupTimer = setInterval(() => { void oidcStore.cleanup(Date.now()).catch(error => console.error('[oidc.cleanup]', error instanceof Error ? error.message : error)); }, 300_000);
oidcCleanupTimer.unref();
const oidcRp = createOidcRelyingParty({ store: oidcStore, redirectUri: process.env.OIDC_REDIRECT_URI || 'https://app.aros.live/auth/callback', sessionTtlMs: Number(process.env.OIDC_SESSION_TTL_SECONDS || 3600) * 1000, mapWorkspace: async (subject, requestedWorkspace) => { const supabase = createSupabaseAdmin(); let query = supabase.from('tenant_members').select('tenant_id,role,status').eq('user_id', subject).eq('status', 'active'); if (requestedWorkspace) query = query.eq('tenant_id', requestedWorkspace); const { data } = await query.order('is_default', { ascending: false }).limit(1); const membership = data?.[0]; return membership ? { workspaceId: membership.tenant_id, role: membership.role } : null; } });

// ── Helpers ─────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url || '/', 'http://' + (req.headers.host || 'app.aros.live'));
}

function readTaskToken(): string {
  const candidates = [
    process.env.SHRE_TASKS_TOKEN,
    process.env.SHRE_TASKS_API_KEY,
    '/root/.shre/vault/shre-tasks.token',
    '/root/.shre/vault/shre-tasks.key',
    (process.env.HOME || '') + '/.shre/vault/shre-tasks.token',
    (process.env.HOME || '') + '/.shre/vault/shre-tasks.key',
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      if (!candidate.startsWith('/')) {
        if (candidate.trim()) return candidate.trim();
        continue;
      }
      if (existsSync(candidate)) {
        const token = readFileSync(candidate, 'utf8').trim();
        if (token) return token;
      }
    } catch {}
  }
  return '';
}

async function proxyRequest(req: IncomingMessage, res: ServerResponse, baseUrl: string): Promise<void> {
  const current = requestUrl(req);
  const upstreamPath = current.pathname.replace(/^\/sx-tasks(?=\/|$)/, '') || '/';
  const upstreamUrl = new URL(upstreamPath, baseUrl);
  upstreamUrl.search = current.search;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null || key.toLowerCase() === 'host') continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  headers.set('X-Brand', 'aros');
  headers.set('X-Forwarded-Host', String(req.headers.host || 'app.aros.live'));
  headers.delete('accept-encoding');

  if (current.pathname.startsWith('/sx-tasks/')) {
    const token = readTaskToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  // Authenticate proxied router traffic that arrived anonymous (browser
  // chat/demo). Never clobbers a caller-provided Authorization header.
  if (upstreamPath.startsWith('/v1/') && !headers.has('authorization') && routerPassportToken) {
    headers.set('Authorization', `Bearer ${routerPassportToken}`);
  }

  const body = ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : req;
  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: body as any,
    duplex: body ? 'half' : undefined,
  } as any);

  const responseHeaders: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    if (['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) return;
    responseHeaders[key] = value;
  });
  res.writeHead(upstream.status, responseHeaders);
  if (upstream.body) {
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  }
  res.end();
}

async function sendStaticFile(res: ServerResponse, filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return false;
    const ext = extname(filePath);
    const headers: Record<string, string> = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (filePath.includes('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    else headers['Cache-Control'] = 'private, no-store'; // authenticated HTML shell must never be cached by a shared proxy/CDN
    res.writeHead(200, headers);
    res.end(await readFile(filePath));
    return true;
  } catch {
    return false;
  }
}

async function serveDashboard(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) return false;
  const { pathname } = requestUrl(req);
  const decodedPath = decodeURIComponent(pathname);
  const safePath = normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const staticPath = join(WEB_DIST, safePath === '/' ? 'index.html' : safePath);
  if (await sendStaticFile(res, staticPath)) return true;
  return sendStaticFile(res, join(WEB_DIST, 'index.html'));
}

function collectBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  try {
    const raw = await collectBody(req, 65_536);
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}

// ── Rate Limiter (per-IP, in-memory) ────────────────────────────

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(req: IncomingMessage, maxRequests: number, windowMs: number): boolean {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  bucket.count++;
  return bucket.count <= maxRequests;
}

// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(ip);
  }
}, 300_000);

// ── Audit Logger ────────────────────────────────────────────────

async function auditLog(opts: {
  tenantId?: string;
  userId?: string;
  action: string;
  resource?: string;
  detail?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  try {
    const supabase = createSupabaseAdmin();
    await supabase.from('audit_log').insert({
      tenant_id: opts.tenantId || null,
      user_id: opts.userId || null,
      action: opts.action,
      resource: opts.resource || null,
      detail: opts.detail || {},
      ip: opts.ip || null,
    });
  } catch (err) {
    // Non-fatal — never block a request for audit logging
    console.error('[audit]', err instanceof Error ? err.message : err);
  }
}

function getClientIp(req: IncomingMessage): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

// ── Brute-Force Login Protection (separate from general rate limiter) ─

const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

function checkLoginThrottle(identifier: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = loginAttempts.get(identifier);

  if (!record) return { allowed: true };

  // Currently locked out
  if (record.lockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((record.lockedUntil - now) / 1000) };
  }

  // Lock expired — reset
  if (record.lockedUntil > 0 && record.lockedUntil <= now) {
    loginAttempts.delete(identifier);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordLoginFailure(identifier: string): void {
  const record = loginAttempts.get(identifier) || { count: 0, lockedUntil: 0 };
  record.count++;

  // Progressive lockout: 5 fails → 1min, 10 → 5min, 15 → 15min, 20+ → 1hr
  if (record.count >= 20) {
    record.lockedUntil = Date.now() + 3_600_000;
  } else if (record.count >= 15) {
    record.lockedUntil = Date.now() + 900_000;
  } else if (record.count >= 10) {
    record.lockedUntil = Date.now() + 300_000;
  } else if (record.count >= 5) {
    record.lockedUntil = Date.now() + 60_000;
  }

  loginAttempts.set(identifier, record);
}

function recordLoginSuccess(identifier: string): void {
  loginAttempts.delete(identifier);
}

// Cleanup stale login records every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, record] of loginAttempts) {
    if (record.lockedUntil > 0 && record.lockedUntil <= now) loginAttempts.delete(id);
  }
}, 600_000);

// ── Input Sanitization ──────────────────────────────────────────

function sanitizeString(input: string, maxLength = 500): string {
  return input
    .slice(0, maxLength)
    .replace(/[<>]/g, '') // Strip angle brackets (XSS)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Strip control chars
    .trim();
}

// ── CORS ────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
  'https://aros.nirtek.net',
  'https://nirtek.net',
  'https://www.nirtek.net',
  'https://pos.nirtek.net',
  'http://localhost:5173', // Vite dev
  'http://localhost:5457', // Local server
]);

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Aros-Tenant-Id, X-Aros-App-Key');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// ── Security Headers ────────────────────────────────────────────

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

// ── Billing Routes ──────────────────────────────────────────────

async function handleBillingCheckout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const { tenantId, plan, email } = body as { tenantId?: string; plan?: string; email?: string };
  if (!tenantId || !plan || !email) {
    return json(res, 400, { error: 'Missing required fields: tenantId, plan, email' });
  }

  const validPlans: PlanId[] = ['starter', 'pro', 'enterprise'];
  if (!validPlans.includes(plan as PlanId)) {
    return json(res, 400, { error: `Invalid plan. Must be one of: ${validPlans.join(', ')}` });
  }

  try {
    const url = await createCheckoutSession({
      tenantId: String(tenantId),
      plan: plan as PlanId,
      email: String(email),
    });

    await auditLog({
      tenantId: String(tenantId),
      action: 'billing.checkout_started',
      resource: 'stripe',
      detail: { plan },
      ip: getClientIp(req),
    });

    json(res, 200, { url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed';
    console.error('[billing/checkout]', message);
    json(res, 500, { error: message });
  }
}

async function handleBillingPortal(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const { stripeCustomerId } = body as { stripeCustomerId?: string };
  if (!stripeCustomerId) {
    return json(res, 400, { error: 'Missing required field: stripeCustomerId' });
  }

  try {
    const url = await createPortalSession(String(stripeCustomerId));
    json(res, 200, { url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Portal session failed';
    console.error('[billing/portal]', message);
    json(res, 500, { error: message });
  }
}

async function handleBillingWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const signature = req.headers['stripe-signature'];
  if (!signature || typeof signature !== 'string') {
    return json(res, 400, { error: 'Missing stripe-signature header' });
  }

  let rawBody: Buffer;
  try {
    rawBody = await collectBody(req);
  } catch {
    return json(res, 413, { error: 'Body too large' });
  }

  const result = await handleStripeWebhook(rawBody, signature);
  json(res, result.status, result.body);
}

async function handleBillingStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const tenantId = url.searchParams.get('tenantId');

  if (!tenantId) {
    return json(res, 400, { error: 'Missing query parameter: tenantId' });
  }

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from('tenants')
      .select(
        'id, plan, billing_status, stripe_customer_id, stripe_subscription_id, license_key, license_tier',
      )
      .eq('id', tenantId)
      .single();

    if (error || !data) {
      return json(res, 404, { error: 'Tenant not found' });
    }

    // If there's an active Stripe subscription, fetch live status
    let subscription = null;
    if (data.stripe_subscription_id) {
      try {
        subscription = await getSubscription(data.stripe_subscription_id);
      } catch {
        // Stripe unreachable — return cached data
      }
    }

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const periodStart = monthStart.toISOString();
    const periodEnd = new Date().toISOString();

    type CurrentPeriodUsage = {
      totalCostUsd?: number;
      totalSavingsUsd?: number;
      totalRequests?: number;
      totalTokens?: number;
      avgCostPerRequest?: number;
      periodFrom?: string;
      periodTo?: string;
    };
    let currentPeriodUsage: CurrentPeriodUsage | null = null;

    try {
      const meterUrl = new URL('/v1/costs/summary', SHRE_METER_URL);
      meterUrl.searchParams.set('from', periodStart);
      meterUrl.searchParams.set('to', periodEnd);
      meterUrl.searchParams.set('tenantId', tenantId);

      const meterRes = await fetch(meterUrl);
      if (meterRes.ok) {
        currentPeriodUsage = (await meterRes.json()) as CurrentPeriodUsage;
      }
    } catch {
      // Best-effort only. Billing status still returns cached subscription state.
    }

    json(res, 200, {
      tenantId: data.id,
      plan: subscription?.plan || data.plan,
      billingStatus: subscription?.status || data.billing_status,
      stripeCustomerId: data.stripe_customer_id,
      subscription,
      licenseTier: data.license_tier,
      currentPeriodSpendCents:
        currentPeriodUsage?.totalCostUsd != null
          ? Math.round(currentPeriodUsage.totalCostUsd * 100)
          : undefined,
      currentPeriodEventCount: currentPeriodUsage?.totalRequests,
      currentPeriodUsage: currentPeriodUsage
        ? {
            totalCents: Math.round((currentPeriodUsage.totalCostUsd || 0) * 100),
            eventCount: currentPeriodUsage.totalRequests,
            periodStart,
            periodEnd,
          }
        : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch billing status';
    console.error('[billing/status]', message);
    json(res, 500, { error: message });
  }
}

// ── Email Verification (OTP via Supabase) ───────────────────────

async function handleSendOtp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const { email } = body as { email?: string };
  if (!email || typeof email !== 'string') {
    return json(res, 400, { error: 'Email is required' });
  }

  try {
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });

    if (error) {
      console.error('[otp/send]', error.message);
      return json(res, 400, { error: error.message });
    }

    await auditLog({
      action: 'auth.otp_sent',
      resource: 'email',
      detail: { email: email.trim() },
      ip: getClientIp(req),
    });

    json(res, 200, { sent: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send OTP';
    console.error('[otp/send]', message);
    json(res, 500, { error: message });
  }
}

async function handleVerifyOtp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const { email, otp } = body as { email?: string; otp?: string };
  if (!email || !otp) {
    return json(res, 400, { error: 'Email and OTP are required' });
  }

  try {
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: String(otp).trim(),
      type: 'email',
    });

    if (error) {
      await auditLog({
        action: 'auth.otp_failed',
        resource: 'email',
        detail: { email: email.trim(), reason: error.message },
        ip: getClientIp(req),
      });
      return json(res, 400, { error: 'Invalid or expired code' });
    }

    await auditLog({
      action: 'auth.email_verified',
      resource: 'email',
      detail: { email: email.trim() },
      ip: getClientIp(req),
    });

    json(res, 200, { verified: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    console.error('[otp/verify]', message);
    json(res, 500, { error: message });
  }
}

// ── Onboarding ──────────────────────────────────────────────────

type OnboardingComponentName = 'model' | 'store' | 'sync' | 'capabilities';
type OnboardingComponentStatus = 'not_started' | 'pending' | 'ready' | 'error' | 'skipped';

function canonicalOnboardingState(row: Record<string, unknown> | null, tenantId: string) {
  const component = (name: OnboardingComponentName) => {
    const value = row?.[name];
    return value && typeof value === 'object' ? value : { status: 'not_started', updatedAt: null };
  };
  return {
    version: Number(row?.version || 1), tenantId,
    phase: String(row?.phase || 'identity_ready'),
    model: component('model'), store: component('store'), sync: component('sync'), capabilities: component('capabilities'),
    completedAt: row?.completed_at ?? null, updatedAt: row?.updated_at ?? new Date().toISOString(),
  };
}

async function resolveOnboardingScope(req: IncomingMessage, tenantId: string, userId?: string) {
  const userAuth = await authenticateRequest(req);
  if (userAuth) return userAuth.tenantId === tenantId ? userAuth : null;
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (String(req.headers['x-service-source'] || '') !== 'mib007' || !tokensMatch(token, readServiceToken())) return null;
  return UUID_RE.test(tenantId) && userId ? { tenantId, userId, role: 'member' } : null;
}

async function setOnboardingComponent(
  tenantId: string, component: OnboardingComponentName, status: OnboardingComponentStatus,
  metadata: Record<string, unknown> = {}, error: string | null = null,
) {
  const { data, error: rpcError } = await createSupabaseAdmin().rpc('set_workspace_onboarding_component', {
    p_tenant_id: tenantId, p_component: component, p_status: status, p_metadata: metadata, p_error: error,
  });
  if (rpcError) throw rpcError;
  const row = Array.isArray(data) ? data[0] : data;
  return canonicalOnboardingState((row as Record<string, unknown> | null) ?? null, tenantId);
}

async function handleOnboardingStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const tenantId = url.searchParams.get('tenantId');

  if (!tenantId) {
    return json(res, 400, { error: 'Missing query parameter: tenantId' });
  }

  const scope = await resolveOnboardingScope(req, tenantId, url.searchParams.get('userId') || undefined);
  if (!scope) return json(res, 401, { error: 'Authentication required' });

  try {
    const supabase = createSupabaseAdmin();
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, onboarding_completed')
      .eq('id', tenantId)
      .single();

    if (!tenant) {
      return json(res, 404, { error: 'Tenant not found' });
    }

    const { data: progress } = await supabase
      .from('onboarding_progress')
      .select('step, step_data, completed_at')
      .eq('tenant_id', tenantId)
      .single();

    const { data: canonical } = await supabase
      .from('workspace_onboarding_state')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    json(res, 200, {
      tenantId: tenant.id,
      completed: tenant.onboarding_completed === true,
      step: progress?.step ?? 1,
      stepData: progress?.step_data ?? {},
      completedAt: progress?.completed_at ?? null,
      state: canonicalOnboardingState(canonical as Record<string, unknown> | null, tenantId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch onboarding status';
    console.error('[onboarding/status]', message);
    json(res, 500, { error: message });
  }
}

async function handleOnboardingComplete(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const { tenantId, companyName, storeName, storeCount, industry, phone, address } = body as {
    tenantId?: string;
    companyName?: string;
    storeName?: string;
    storeCount?: number;
    industry?: string;
    phone?: string;
    address?: Record<string, string>;
  };

  if (!tenantId) {
    return json(res, 400, { error: 'tenantId is required' });
  }

  try {
    const supabase = createSupabaseAdmin();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return json(res, 401, { error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return json(res, 401, { error: 'Invalid session' });
    }

    const { data: membership, error: membershipError } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError || !membership || !['owner', 'admin', 'member'].includes(String(membership.role))) {
      return json(res, 403, { error: 'You do not have access to complete onboarding for this tenant' });
    }

    const { error: tenantError } = await supabase
      .from('tenants')
      .update({
        name: companyName || undefined,
        store_count: typeof storeCount === 'number' ? storeCount : undefined,
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tenantId);

    if (tenantError) throw tenantError;

    const { error: progressError } = await supabase
      .from('onboarding_progress')
      .upsert({
        tenant_id: tenantId,
        step: 4,
        step_data: { companyName, storeName, storeCount, industry, phone, address },
        completed_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' });

    if (progressError) throw progressError;

    await auditLog({
      tenantId,
      userId: user.id,
      action: 'onboarding.completed',
      resource: 'tenant',
      detail: { companyName, industry },
      ip: getClientIp(req),
    });

    json(res, 200, { completed: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to complete onboarding';
    console.error('[onboarding/complete]', message);
    json(res, 500, { error: message });
  }
}

async function handleOnboardingProgress(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const { tenantId, step, stepData } = body as {
    tenantId?: string;
    step?: number;
    stepData?: Record<string, unknown>;
  };

  if (!tenantId) return json(res, 400, { error: 'tenantId is required' });

  try {
    const supabase = createSupabaseAdmin();
    const requestedUserId = typeof (body as Record<string, unknown>).userId === 'string'
      ? String((body as Record<string, unknown>).userId) : undefined;
    const scope = await resolveOnboardingScope(req, tenantId, requestedUserId);
    if (!scope) return json(res, 401, { error: 'Authentication required' });

    // Merge step_data and never regress the recorded step — progress only moves
    // forward, so a stale/out-of-order write can't rewind a resumable journey.
    const { data: existing } = await supabase
      .from('onboarding_progress')
      .select('step, step_data')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const currentStep = typeof existing?.step === 'number' ? existing.step : 1;
    const requestedStep = typeof step === 'number' && Number.isFinite(step) ? Math.floor(step) : currentStep;
    const nextStep = Math.max(currentStep, requestedStep);
    const mergedData = {
      ...(existing?.step_data && typeof existing.step_data === 'object' ? existing.step_data : {}),
      ...(stepData && typeof stepData === 'object' ? stepData : {}),
    };

    const { error: progressError } = await supabase
      .from('onboarding_progress')
      .upsert({ tenant_id: tenantId, step: nextStep, step_data: mergedData }, { onConflict: 'tenant_id' });

    if (progressError) throw progressError;

    let state = null;
    if (stepData?.model && typeof stepData.model === 'object') {
      state = await setOnboardingComponent(tenantId, 'model', 'ready', stepData.model as Record<string, unknown>);
    }

    json(res, 200, { ok: true, step: nextStep, stepData: mergedData, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save onboarding progress';
    console.error('[onboarding/progress]', message);
    json(res, 500, { error: message });
  }
}

async function handleOnboardingComponent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId : '';
  const userId = typeof body.userId === 'string' ? body.userId : undefined;
  const component = body.component as OnboardingComponentName;
  const status = body.status as OnboardingComponentStatus;
  if (!UUID_RE.test(tenantId)) return json(res, 400, { error: 'Valid tenantId is required' });
  if (!['model', 'store', 'sync', 'capabilities'].includes(component)) return json(res, 400, { error: 'Invalid component' });
  if (!['not_started', 'pending', 'ready', 'error', 'skipped'].includes(status)) return json(res, 400, { error: 'Invalid status' });
  const scope = await resolveOnboardingScope(req, tenantId, userId);
  if (!scope) return json(res, 401, { error: 'Authentication required' });
  try {
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown> : {};
    const state = await setOnboardingComponent(tenantId, component, status, metadata, typeof body.error === 'string' ? body.error : null);
    json(res, 200, { state });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : 'Failed to update onboarding state' });
  }
}

// ── Signup ──────────────────────────────────────────────────────

async function ensureSignupTenant(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  input: {
    userId: string;
    company: string;
    posSystem: string | null;
    storeCount?: number;
  },
): Promise<{ tenantId: string; licenseKey: string | null; existing: boolean }> {
  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', input.userId)
    .limit(1)
    .maybeSingle();

  if (membership?.tenant_id) {
    return { tenantId: membership.tenant_id, licenseKey: null, existing: true };
  }

  const { data: ownedTenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_id', input.userId)
    .limit(1)
    .maybeSingle();

  let tenantId = ownedTenant?.id as string | undefined;

  if (!tenantId) {
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        name: input.company,
        owner_id: input.userId,
        plan: 'free',
        billing_status: 'none',
        pos_system: input.posSystem,
        store_count: typeof input.storeCount === 'number' ? input.storeCount : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (tenantError || !tenant) {
      throw new Error(tenantError?.message || 'Failed to create tenant');
    }
    tenantId = tenant.id;
  }

  if (!tenantId) {
    throw new Error('Failed to resolve tenant after signup');
  }
  const ensuredTenantId = tenantId;

  await supabase.from('tenant_members').insert({
    tenant_id: ensuredTenantId,
    user_id: input.userId,
    role: 'owner',
    is_default: true,
    status: 'active',
  });

  await supabase.from('onboarding_progress').upsert({
    tenant_id: ensuredTenantId,
    step: 1,
    step_data: {},
  }, { onConflict: 'tenant_id' });

  let licenseKey: string | null = null;
  try {
    licenseKey = await provisionLicense(ensuredTenantId, 'free');
  } catch (err) {
    console.error(
      '[signup] License provisioning failed:',
      err instanceof Error ? err.message : err,
    );
  }

  // Core baseline: the concierge agent and connector-independent skills every
  // workspace starts with. Non-fatal — the migration backfill reconciles any
  // tenant this call misses.
  const { error: baselineError } = await supabase.rpc('apply_provisioning_manifest', {
    p_tenant_id: ensuredTenantId, p_source_kind: 'app', p_source_id: 'core',
    p_manifest_key: 'app.core.v1', p_activate: true, p_actor: input.userId,
  });
  if (baselineError) console.error('[signup] Core baseline provisioning failed:', baselineError.message);

  return { tenantId: ensuredTenantId, licenseKey, existing: false };
}

async function handleSignup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!rateLimit(req, 5, 60_000)) {
    return json(res, 429, { error: 'Too many signup attempts. Please wait a minute.' });
  }

  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const { name, email, password, company, posSystem, storeCount, intent } = body as {
    name?: string;
    email?: string;
    password?: string;
    company?: string;
    posSystem?: string;
    storeCount?: number;
    intent?: string;
  };

  // Validate required fields
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return json(res, 400, { error: 'Name is required (min 2 characters)' });
  }
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json(res, 400, { error: 'Valid email is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return json(res, 400, { error: 'Password must be at least 8 characters' });
  }
  if (!/[A-Z]/.test(password)) {
    return json(res, 400, { error: 'Password must contain at least one uppercase letter' });
  }
  if (!/[a-z]/.test(password)) {
    return json(res, 400, { error: 'Password must contain at least one lowercase letter' });
  }
  if (!/[0-9]/.test(password)) {
    return json(res, 400, { error: 'Password must contain at least one number' });
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return json(res, 400, { error: 'Password must contain at least one special character' });
  }
  if (!company || typeof company !== 'string' || company.trim().length < 2) {
    return json(res, 400, { error: 'Company name is required (min 2 characters)' });
  }

  // Sanitize all text inputs
  const safeName = sanitizeString(String(name), 100);
  const safeEmail = email.trim().toLowerCase().slice(0, 254);
  const safeCompany = sanitizeString(String(company), 200);
  const safePosSystem = posSystem ? sanitizeString(String(posSystem), 50) : null;
  // The one-question signup intent ("what do you want your agent to do?") seeds
  // the day-one demo scenario + default tools. Stored in freeform user_metadata
  // (no tenant-schema migration needed).
  const safeIntent = intent ? sanitizeString(String(intent), 50) : null;

  const clientIp = getClientIp(req);

  try {
    const supabase = createSupabaseAdmin();

    // 1. Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: safeEmail,
      password,
      email_confirm: true,
      user_metadata: {
        name: safeName,
        company: safeCompany,
        intent: safeIntent,
      },
    });

    if (authError || !authData.user) {
      const msg = authError?.message || 'Failed to create user';
      if (msg.includes('already') || msg.includes('duplicate')) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: safeEmail,
          password: String(password),
        });
        if (signInError || !signInData.user) {
          await auditLog({ action: 'signup.duplicate', detail: { email: safeEmail }, ip: clientIp });
          return json(res, 409, { error: 'An account with this email already exists' });
        }

        const ensured = await ensureSignupTenant(supabase, {
          userId: signInData.user.id,
          company: safeCompany,
          posSystem: safePosSystem,
          storeCount,
        });

        await auditLog({
          tenantId: ensured.tenantId,
          userId: signInData.user.id,
          action: ensured.existing ? 'signup.duplicate_login_ready' : 'signup.recovered',
          resource: 'tenant',
          detail: { email: safeEmail, company: safeCompany, plan: 'free' },
          ip: clientIp,
        });

        return json(res, ensured.existing ? 200 : 201, {
          recovered: !ensured.existing,
          user: {
            id: signInData.user.id,
            email: signInData.user.email,
            name: safeName,
          },
          tenant: {
            id: ensured.tenantId,
            name: safeCompany,
            plan: 'free',
            licenseKey: ensured.licenseKey,
          },
        });
      }
      return json(res, 400, { error: msg });
    }

    const { data: createdSignInData, error: createdSignInError } = await supabase.auth.signInWithPassword({
      email: safeEmail,
      password: String(password),
    });
    if (createdSignInError || !createdSignInData.user) {
      throw new Error(createdSignInError?.message || 'Created account could not be signed in for tenant provisioning');
    }

    const userId = createdSignInData.user.id;
    const ensured = await ensureSignupTenant(supabase, {
      userId,
      company: safeCompany,
      posSystem: safePosSystem,
      storeCount,
    });
    const tenantId = ensured.tenantId;
    const modelEnrollmentToken = randomBytes(32).toString('base64url');
    const modelEnrollmentHash = createHash('sha256').update(modelEnrollmentToken).digest('hex');
    const { error: modelError } = await supabase.from('tenant_resources').upsert({
      tenant_id: tenantId, kind: 'model', provider: DEFAULT_MODEL.provider, name: DEFAULT_MODEL.label,
      status: 'configuring', created_by: userId, capabilities: ['chat.completions'],
      config: { modelId: DEFAULT_MODEL.id, endpoint: DEFAULT_MODEL.endpoint, local: true },
    }, { onConflict: 'tenant_id,kind,name' });
    if (modelError) console.error('[signup] Default model provisioning failed:', modelError.message);
    const { error: enrollmentError } = await supabase.from('model_enrollments').insert({
      tenant_id: tenantId, model_id: DEFAULT_MODEL.id, token_hash: modelEnrollmentHash,
      created_by: userId, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    if (enrollmentError) console.error('[signup] Model enrollment provisioning failed:', enrollmentError.message);

    // 6. Audit log
    await auditLog({
      tenantId,
      userId,
      action: 'signup.completed',
      resource: 'tenant',
      detail: { email: safeEmail, company: safeCompany, posSystem: safePosSystem, plan: 'free' },
      ip: clientIp,
    });

    json(res, 201, {
      user: {
        id: userId,
        email: authData.user.email,
        name: safeName,
      },
      tenant: {
        id: tenantId,
        name: safeCompany,
        plan: 'free',
        licenseKey: ensured.licenseKey,
      },
      model: { ...DEFAULT_MODEL, status: 'configuring', enrollmentToken: modelEnrollmentToken, expiresIn: 86_400 },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signup failed';
    console.error('[signup]', message);
    json(res, 500, { error: message });
  }
}

// ── Login (server-side with brute-force protection) ─────────────

async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const { email, password } = body as { email?: string; password?: string };
  if (!email || !password) {
    return json(res, 400, { error: 'Email and password are required' });
  }

  const safeEmail = email.trim().toLowerCase();
  const clientIp = getClientIp(req);
  const throttleKey = `${safeEmail}:${clientIp}`;

  // Check brute-force lockout
  const throttle = checkLoginThrottle(throttleKey);
  if (!throttle.allowed) {
    await auditLog({
      action: 'auth.login_locked',
      detail: { email: safeEmail, retryAfter: throttle.retryAfter },
      ip: clientIp,
    });
    return json(res, 429, {
      error: `Account temporarily locked. Try again in ${throttle.retryAfter} seconds.`,
      retryAfter: throttle.retryAfter,
    });
  }

  try {
    const supabase = createSupabaseAdmin();

    // Use admin client to verify credentials
    const { data, error } = await supabase.auth.signInWithPassword({
      email: safeEmail,
      password: String(password),
    });

    if (error || !data.session) {
      recordLoginFailure(throttleKey);
      await auditLog({
        action: 'auth.login_failed',
        detail: { email: safeEmail },
        ip: clientIp,
      });
      // Generic message — don't reveal whether email exists
      return json(res, 401, { error: 'Invalid email or password' });
    }

    recordLoginSuccess(throttleKey);

    await auditLog({
      userId: data.user.id,
      action: 'auth.login_success',
      detail: { email: safeEmail },
      ip: clientIp,
    });

    json(res, 200, {
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.name,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Login failed';
    console.error('[login]', message);
    json(res, 500, { error: 'Login failed' });
  }
}

// ── Lead Capture ─────────────────────────────────────────────

async function handleLeadCapture(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const { name, email, business_name, posSystem, source, utm_campaign, notes } = body as {
    name?: string;
    email?: string;
    business_name?: string;
    posSystem?: string;
    source?: string;
    utm_campaign?: string;
    notes?: string;
  };

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return json(res, 400, { error: 'Name is required' });
  }
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json(res, 400, { error: 'Valid email is required' });
  }

  const safeName = sanitizeString(String(name), 100);
  const safeEmail = email.trim().toLowerCase().slice(0, 254);

  try {
    const supabase = createSupabaseAdmin();

    // Upsert lead by email (deduplicates)
    const { error } = await supabase.from('leads').upsert(
      {
        name: safeName,
        email: safeEmail,
        business_name: business_name ? sanitizeString(String(business_name), 200) : null,
        pos_system: posSystem ? sanitizeString(String(posSystem), 50) : null,
        source: source ? sanitizeString(String(source), 100) : 'contact_form',
        utm_campaign: utm_campaign ? sanitizeString(String(utm_campaign), 100) : null,
        notes: notes ? sanitizeString(String(notes), 2000) : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email' },
    );

    if (error) {
      console.error('[leads]', error.message);
      return json(res, 500, { error: 'Failed to save lead' });
    }

    await auditLog({
      action: 'lead.captured',
      resource: 'leads',
      detail: { email: safeEmail, source },
      ip: getClientIp(req),
    });

    json(res, 200, { ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to capture lead';
    console.error('[leads]', message);
    json(res, 500, { error: message });
  }
}

// ── Auth Helper ─────────────────────────────────────────────────

type AuthContext = {
  userId: string;
  tenantId: string;
  role: string;
  // Platform role bundle (contracts/platform/role-bundle.v1): derived from
  // Zitadel bundle:* roles, or the owner-fallback for legacy memberships;
  // null = most-restricted once enforcement consumes it (carried today).
  bundle: string | null;
};

const SHRE_ID_PROJECT_ID = process.env.SHRE_ID_PROJECT_ID || DEFAULT_SHRE_ID_PROJECT_ID;

function getRequestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
}

function getRequestedTenantId(req: IncomingMessage): string | null {
  const headerTenantId = req.headers['x-aros-tenant-id'] ?? req.headers['x-tenant-id'];
  if (Array.isArray(headerTenantId)) return headerTenantId[0] || null;
  if (typeof headerTenantId === 'string' && headerTenantId.trim()) return headerTenantId.trim();
  return getRequestUrl(req).searchParams.get('tenantId');
}

async function authenticateRequest(req: IncomingMessage): Promise<AuthContext | null> {
  const oidcSession = await oidcRp.authenticate(req.headers.cookie);
  if (oidcSession) { const requestedTenantId = getRequestedTenantId(req); if (requestedTenantId && requestedTenantId !== oidcSession.workspaceId) return null; return { userId: oidcSession.subject, tenantId: oidcSession.workspaceId, role: oidcSession.role, bundle: resolveBundle(oidcSession.claims as Record<string, unknown>, oidcSession.role, SHRE_ID_PROJECT_ID) }; }
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  try {
    const supabase = createSupabaseAdmin();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;

    const requestedTenantId = getRequestedTenantId(req);
    let membership: { tenant_id: string; role: string; status: string } | undefined;
    for (let attempt = 0; attempt < 2 && !membership; attempt += 1) {
      let membershipQuery = supabase
        .from('tenant_members')
        .select('tenant_id, role, status')
        .eq('user_id', user.id)
        .eq('status', 'active');
      if (requestedTenantId) membershipQuery = membershipQuery.eq('tenant_id', requestedTenantId);
      const { data: memberships, error: membershipError } = await membershipQuery
        .order('is_default', { ascending: false })
        .order('joined_at', { ascending: true })
        .limit(1);
      if (!membershipError) membership = memberships?.[0];
      if (!membership && attempt === 0) await new Promise(resolve => setTimeout(resolve, 250));
    }

    if (!membership) return null;
    return {
      userId: user.id,
      tenantId: membership.tenant_id,
      role: membership.role || 'member',
      bundle: resolveBundle(null, membership.role, SHRE_ID_PROJECT_ID),
    };
  } catch {
    return null;
  }
}

function canManageMarketplace(role: string): boolean {
  return ['owner', 'admin'].includes(role);
}

function normalizeAppKey(raw: unknown): string {
  const value = String(raw ?? '').trim().toLowerCase();
  const aliases: Record<string, string> = {
    '@aros/storepulse-ui': 'storepulse',
    'storepulse-ui': 'storepulse',
    'storepulse.aros.live': 'storepulse',
    'storepulse-hq': 'storepulse',
    '@aros/shre-chat': 'chat',
    'shre-chat': 'chat',
    'chat.aros.live': 'chat',
    'rapid-support': 'rapidsupport',
    'rapidsupport.aros.live': 'rapidsupport',
    atomdesk: 'centrix',
    'centrix.aros.live': 'centrix',
  };
  return (aliases[value] ?? value).replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-');
}

type AppLaunchGrant = {
  appKey: string;
  tenantId: string;
  userId: string;
  role: string;
  bundle: string | null;
  storeIds: string[];
  expiresAt: number;
};

const appLaunchGrants = new Map<string, AppLaunchGrant>();
const APP_LAUNCH_TTL_MS = 60_000;

function hashAppLaunchCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

async function handleAppLaunchCreate(req: IncomingMessage, res: ServerResponse, appKeyParam: string): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  const appKey = normalizeAppKey(appKeyParam);
  const supabase = createSupabaseAdmin();
  const [{ data: app }, { data: entitlement }] = await Promise.all([
    supabase.from('platform_apps').select('id,launch_url,status').eq('id', appKey).maybeSingle(),
    supabase.from('marketplace_app_entitlements').select('status,service_config').eq('tenant_id', auth.tenantId).eq('app_key', appKey).maybeSingle(),
  ]);
  if (!app || app.status !== 'active') return json(res, 409, { error: 'This app is not launch-ready' });
  if (entitlement?.status !== 'active') return json(res, 403, { error: 'Activate this app before opening it' });
  if (appKey !== 'storepulse') return json(res, 409, { error: 'This app has not completed the workspace SSO contract' });
  const code = randomBytes(32).toString('base64url');
  const storeIds = Array.isArray(entitlement.service_config?.storeIds) ? entitlement.service_config.storeIds.map(String) : [];
  appLaunchGrants.set(hashAppLaunchCode(code), { appKey, tenantId: auth.tenantId, userId: auth.userId, role: auth.role, bundle: auth.bundle, storeIds, expiresAt: Date.now() + APP_LAUNCH_TTL_MS });
  for (const [key, grant] of appLaunchGrants) if (grant.expiresAt <= Date.now()) appLaunchGrants.delete(key);
  await auditLog({ tenantId: auth.tenantId, userId: auth.userId, action: 'app.launch_started', resource: `app:${appKey}`, detail: { appKey, storeCount: storeIds.length }, ip: getClientIp(req) });
  const launchUrl = new URL('/api/auth/aros-launch', app.launch_url);
  launchUrl.searchParams.set('code', code);
  res.setHeader('Cache-Control', 'no-store');
  json(res, 200, { launchUrl: launchUrl.toString(), expiresIn: APP_LAUNCH_TTL_MS / 1000 });
}

async function handleAppLaunchConsume(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody(req);
  const code = typeof body?.code === 'string' ? body.code : '';
  const appKey = normalizeAppKey(body?.appKey);
  if (!code || !appKey) return json(res, 400, { error: 'code and appKey are required' });
  const key = hashAppLaunchCode(code);
  const grant = appLaunchGrants.get(key);
  appLaunchGrants.delete(key);
  res.setHeader('Cache-Control', 'no-store');
  if (!grant || grant.expiresAt <= Date.now() || grant.appKey !== appKey) return json(res, 401, { error: 'Launch code is invalid or expired' });
  const supabase = createSupabaseAdmin();
  const [{ data: userResult }, { data: connectors }] = await Promise.all([
    supabase.auth.admin.getUserById(grant.userId),
    grant.storeIds.length ? supabase.from('tenant_connectors').select('id,type,name,config,status').eq('tenant_id', grant.tenantId).in('id', grant.storeIds) : Promise.resolve({ data: [] }),
  ]);
  const user = userResult?.user;
  if (!user) return json(res, 401, { error: 'Workspace user is no longer available' });
  await auditLog({ tenantId: grant.tenantId, userId: grant.userId, action: 'app.launch_consumed', resource: `app:${appKey}`, detail: { appKey }, ip: getClientIp(req) });
  json(res, 200, { appKey, tenantId: grant.tenantId, userId: grant.userId, email: user.email || '', name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User', role: grant.role, bundle: grant.bundle, stores: connectors || [] });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function handleMarketplaceEntitlements(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from('marketplace_app_entitlements')
      .select('id, tenant_id, app_key, status, source, enabled_by, enabled_at, disabled_at, role_mapping, service_config, metadata, created_at, updated_at')
      .eq('tenant_id', auth.tenantId)
      .order('app_key', { ascending: true });

    if (error) throw error;
    json(res, 200, { entitlements: data || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list marketplace entitlements';
    console.error('[marketplace.entitlements]', message);
    json(res, 500, { error: message });
  }
}

async function handleMarketplaceInstall(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  if (!canManageMarketplace(auth.role)) return json(res, 403, { error: 'Owner or admin role required' });

  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const appKey = normalizeAppKey(body.appKey ?? body.nodeId);
  if (!appKey) return json(res, 400, { error: 'Missing required field: appKey or nodeId' });

  try {
    const supabase = createSupabaseAdmin();
    const payload = {
      tenant_id: auth.tenantId,
      app_key: appKey,
      status: 'active',
      source: String(body.source || 'marketplace'),
      enabled_by: auth.userId,
      enabled_at: new Date().toISOString(),
      disabled_at: null,
      role_mapping: isRecord(body.roleMapping) ? body.roleMapping : {},
      service_config: isRecord(body.config) ? body.config : {},
      metadata: {
        ...(isRecord(body.metadata) ? body.metadata : {}),
        nodeId: typeof body.nodeId === 'string' ? body.nodeId : appKey,
      },
    };

    const { data, error } = await supabase
      .from('marketplace_app_entitlements')
      .upsert(payload, { onConflict: 'tenant_id,app_key' })
      .select()
      .single();

    if (error) throw error;

    // Auto-assign the per-tenant MIB Documents token on activation.
    if (appKey === DOCUMENTS_APP_KEY) await provisionDocumentsAccess(supabase, auth.tenantId);

    await auditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'marketplace.app_enabled',
      resource: appKey,
      detail: { appKey, source: payload.source },
      ip: getClientIp(req),
    });

    json(res, 200, { ok: true, entitlement: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to install marketplace app';
    console.error('[marketplace.install]', message);
    json(res, 500, { error: message });
  }
}

async function handleMarketplaceDisable(req: IncomingMessage, res: ServerResponse, appKeyParam: string): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  if (!canManageMarketplace(auth.role)) return json(res, 403, { error: 'Owner or admin role required' });

  const appKey = normalizeAppKey(appKeyParam);
  if (!appKey) return json(res, 400, { error: 'Missing app key' });

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from('marketplace_app_entitlements')
      .update({
        status: 'disabled',
        disabled_at: new Date().toISOString(),
      })
      .eq('tenant_id', auth.tenantId)
      .eq('app_key', appKey)
      .select()
      .single();

    if (error) throw error;

    await supabase.from('tenant_resources').update({
      status: 'inactive',
      health: { state: 'disabled', checkedAt: new Date().toISOString() },
    }).eq('tenant_id', auth.tenantId).eq('kind', 'app').eq('provider', appKey);

    await auditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'marketplace.app_disabled',
      resource: appKey,
      detail: { appKey },
      ip: getClientIp(req),
    });

    json(res, 200, { ok: true, entitlement: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to disable marketplace app';
    console.error('[marketplace.disable]', message);
    json(res, 500, { error: message });
  }
}

async function handleAppEntitlement(req: IncomingMessage, res: ServerResponse, appKeyParam: string): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });

  const appKey = normalizeAppKey(appKeyParam);
  if (!appKey) return json(res, 400, { error: 'Missing app key' });

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from('marketplace_app_entitlements')
      .select('id, tenant_id, app_key, status, role_mapping, service_config, metadata, enabled_at, disabled_at')
      .eq('tenant_id', auth.tenantId)
      .eq('app_key', appKey)
      .maybeSingle();

    if (error) throw error;

    json(res, 200, {
      appKey,
      tenantId: auth.tenantId,
      entitled: data?.status === 'active',
      entitlement: data || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to check app entitlement';
    console.error('[app.entitlement]', message);
    json(res, 500, { error: message });
  }
}

const RESOURCE_KINDS = new Set(['channel', 'pos', 'app', 'agent', 'skill', 'model']);

async function handleTenantResources(req: IncomingMessage, res: ServerResponse, kind: string, id?: string): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  if (!RESOURCE_KINDS.has(kind)) return json(res, 400, { error: 'Invalid resource kind' });
  const supabase = createSupabaseAdmin();
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('tenant_resources').select('*').eq('tenant_id', auth.tenantId).eq('kind', kind).order('name');
    return error ? json(res, 500, { error: error.message }) : json(res, 200, { resources: data || [] });
  }
  if (!['owner', 'admin'].includes(auth.role)) return json(res, 403, { error: 'Workspace admin access required' });
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON body' });
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) return json(res, 400, { error: 'name is required' });
  const config = body.config && typeof body.config === 'object' ? body.config : {};
  if (/"(password|apikey|api_key|token|secret)"\s*:/.test(JSON.stringify(config).toLowerCase())) return json(res, 400, { error: 'Submit only a vault reference, never raw credentials.' });
  const allowedStatus = new Set(['inactive', 'configuring', 'active', 'degraded', 'failed']);
  const record = { tenant_id: auth.tenantId, kind, name, provider: typeof body.provider === 'string' ? body.provider.slice(0, 80) : null, status: allowedStatus.has(String(body.status)) ? body.status : 'inactive', config, store_ids: Array.isArray(body.storeIds) ? body.storeIds : [], capabilities: Array.isArray(body.capabilities) ? body.capabilities.map(String) : [], health: body.health && typeof body.health === 'object' ? body.health : {}, created_by: auth.userId };
  const query = id ? supabase.from('tenant_resources').update(record).eq('id', id).eq('tenant_id', auth.tenantId).eq('kind', kind).select().single() : supabase.from('tenant_resources').insert(record).select().single();
  const { data, error } = await query;
  if (error) return json(res, error.code === '23505' ? 409 : 500, { error: error.message });
  await auditLog({ tenantId: auth.tenantId, userId: auth.userId, action: id ? 'resource.updated' : 'resource.created', resource: `${kind}:${data.id}`, detail: { name, status: record.status }, ip: getClientIp(req) });
  json(res, id ? 200 : 201, { resource: data });
}

async function handlePlatformApps(req: IncomingMessage, res: ServerResponse, appId?: string): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  const supabase = createSupabaseAdmin();
  if (req.method === 'GET') {
    const [{ data: apps, error }, { data: grants }] = await Promise.all([supabase.from('platform_apps').select('*').order('name'), supabase.from('marketplace_app_entitlements').select('app_key,status,service_config').eq('tenant_id', auth.tenantId)]);
    // Publish each app's capability bundle so the marketplace can show what
    // activation unlocks (skills/agents/tools) before the user commits.
    return error ? json(res, 500, { error: error.message }) : json(res, 200, { apps: (apps || []).map(app => ({ ...app, bundle: APP_CAPABILITY_BUNDLES[app.id] || null })), grants: grants || [] });
  }
  if (!appId) return json(res, 400, { error: 'app id required' });
  if (!['owner', 'admin'].includes(auth.role)) return json(res, 403, { error: 'Workspace admin access required' });
  const { data: app } = await supabase.from('platform_apps').select('id,name,launch_url,required_scopes,status').eq('id', appId).single();
  if (!app) return json(res, 404, { error: 'App not found' });
  if (app.status !== 'active') return json(res, 409, { error: 'This app has not completed its launch and workspace SSO contract' });
  const body = await parseJsonBody(req) || {};
  const requested = Array.isArray(body.scopes) ? body.scopes.map(String) : app.required_scopes;
  const allowed = new Set<string>(app.required_scopes || []);
  if (requested.some((scope: string) => !allowed.has(scope))) return json(res, 400, { error: 'Scope is not registered for this app' });
  const requestedStoreIds = Array.isArray(body.storeIds) ? [...new Set(body.storeIds.map(String))] : [];
  const { data: validStores, error: storeError } = requestedStoreIds.length ? await supabase.from('tenant_connectors').select('id').eq('tenant_id', auth.tenantId).eq('status', 'connected').in('id', requestedStoreIds) : { data: [], error: null };
  if (storeError) return json(res, 500, { error: storeError.message });
  if ((validStores || []).length !== requestedStoreIds.length) return json(res, 400, { error: 'Store access includes an unavailable or unhealthy connection' });
  const storeIds = (validStores || []).map(store => store.id);
  const activationState = storeIds.length ? 'ready' : 'needs_store';
  const { data, error } = await supabase.from('marketplace_app_entitlements').upsert({ tenant_id: auth.tenantId, app_key: appId, status: 'active', source: 'aros-app-catalog', enabled_by: auth.userId, enabled_at: new Date().toISOString(), disabled_at: null, service_config: { scopes: requested, storeIds, activationState } }, { onConflict: 'tenant_id,app_key' }).select().single();
  if (error) return json(res, 500, { error: error.message });
  // Auto-assign the per-tenant MIB Documents token on activation.
  if (appId === DOCUMENTS_APP_KEY) await provisionDocumentsAccess(supabase, auth.tenantId);
  const appCapabilities: Record<string, string[]> = {
    storepulse: ['stores.read', 'pos.sales.read', 'pos.inventory.read', 'connection.health.read'],
  };
  const capabilities = appCapabilities[appId] || requested;
  const { error: resourceError } = await supabase.from('tenant_resources').upsert({
    tenant_id: auth.tenantId,
    kind: 'app',
    provider: appId,
    name: app.name,
    status: activationState === 'ready' ? 'active' : 'configuring',
    config: { appKey: appId, launchUrl: app.launch_url, activationState },
    store_ids: storeIds,
    capabilities,
    health: { state: activationState, checkedAt: new Date().toISOString(), detail: storeIds.length ? `${storeIds.length} connected store${storeIds.length === 1 ? '' : 's'} mapped` : 'Connect a healthy store to begin syncing' },
    created_by: auth.userId,
  }, { onConflict: 'tenant_id,kind,name' });
  if (resourceError) return json(res, 500, { error: resourceError.message });
  const bundle = APP_CAPABILITY_BUNDLES[appId];
  const bundleResources = [
    ...(bundle?.skills || []).map(skill => ({ ...skill, kind: 'skill' as const })),
    ...(bundle?.agents || []).map(agent => ({ ...agent, kind: 'agent' as const })),
  ];
  if (bundleResources.length) {
    const resourceRows = bundleResources.map(resource => ({
      tenant_id: auth.tenantId, kind: resource.kind, provider: appId, name: resource.name,
      status: activationState === 'ready' ? 'active' : 'configuring', capabilities: resource.capabilities,
      config: { appKey: appId, managedByApp: true }, store_ids: storeIds,
      health: { state: activationState, checkedAt: new Date().toISOString() }, created_by: auth.userId,
    }));
    const { error: bundleError } = await supabase.from('tenant_resources').upsert(resourceRows, { onConflict: 'tenant_id,kind,name' });
    if (bundleError) return json(res, 500, { error: bundleError.message });
  }
  // What this activation just made available — lets the UI show the
  // "you unlocked N skills / agents / tools" moment instead of a bare grant.
  const unlocked = {
    app: app.name,
    skills: (bundle?.skills || []).map(skill => skill.name),
    agents: (bundle?.agents || []).map(agent => agent.name),
    tools: bundle?.tools || [],
    activationState,
  };
  await auditLog({ tenantId: auth.tenantId, userId: auth.userId, action: 'app.granted', resource: `app:${appId}`, detail: { scopes: requested, storeIds, activationState, capabilities, unlocked: { skills: unlocked.skills.length, agents: unlocked.agents.length, tools: unlocked.tools.length } }, ip: getClientIp(req) });
  json(res, 200, { grant: data, unlocked });
}

async function handleWorkspaceCompat(req: IncomingMessage, res: ServerResponse, workspaceId: string): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  if (auth.tenantId !== workspaceId) return json(res, 403, { error: 'Workspace access denied' });
  const supabase = createSupabaseAdmin();
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('tenants').select('id,name,plan,timezone,currency,status,created_at,updated_at').eq('id', workspaceId).single();
    return error || !data ? json(res, 404, { error: 'Workspace not found' }) : json(res, 200, {
      id: data.id, name: data.name, plan: data.plan, timezone: data.timezone, currency: data.currency,
      status: data.status, createdAt: data.created_at, updatedAt: data.updated_at,
    });
  }
  if (!['owner', 'admin'].includes(auth.role)) return json(res, 403, { error: 'Workspace admin access required' });
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });
  const update: Record<string, string> = {};
  if (typeof body.name === 'string' && body.name.trim()) update.name = sanitizeString(body.name, 120);
  if (typeof body.timezone === 'string' && body.timezone.trim()) update.timezone = sanitizeString(body.timezone, 80);
  if (typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency)) update.currency = body.currency;
  if (!Object.keys(update).length) return json(res, 400, { error: 'No supported workspace fields supplied' });
  const { data, error } = await supabase.from('tenants').update({ ...update, updated_at: new Date().toISOString() }).eq('id', workspaceId).select('id,name,plan,timezone,currency,status,created_at,updated_at').single();
  if (error || !data) return json(res, 500, { error: error?.message || 'Workspace update failed' });
  await auditLog({ tenantId: workspaceId, userId: auth.userId, action: 'workspace.updated', resource: `workspace:${workspaceId}`, detail: { fields: Object.keys(update) }, ip: getClientIp(req) });
  json(res, 200, { id: data.id, name: data.name, plan: data.plan, timezone: data.timezone, currency: data.currency, status: data.status, createdAt: data.created_at, updatedAt: data.updated_at });
}

async function workspaceMembers(workspaceId: string) {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase.from('tenant_members').select('id,user_id,role,status,joined_at').eq('tenant_id', workspaceId).order('joined_at');
  if (error) throw error;
  return Promise.all((data || []).map(async member => {
    const { data: userResult } = await supabase.auth.admin.getUserById(member.user_id);
    const user = userResult?.user;
    return {
      id: member.id, principalType: 'user', principalId: member.user_id, status: member.status,
      membershipRole: member.role, createdAt: member.joined_at, updatedAt: member.joined_at,
      user: user ? { id: user.id, name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Member', email: user.email || '' } : null,
    };
  }));
}

async function handleWorkspaceMembersCompat(req: IncomingMessage, res: ServerResponse, workspaceId: string, memberId?: string): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  if (auth.tenantId !== workspaceId) return json(res, 403, { error: 'Workspace access denied' });
  try {
    if (req.method === 'GET' && !memberId) return json(res, 200, await workspaceMembers(workspaceId));
    if (!['owner', 'admin'].includes(auth.role)) return json(res, 403, { error: 'Workspace admin access required' });
    if (!memberId) return json(res, 400, { error: 'Member id required' });
    const supabase = createSupabaseAdmin();
    const { data: target } = await supabase.from('tenant_members').select('id,user_id,role').eq('tenant_id', workspaceId).eq('id', memberId).single();
    if (!target) return json(res, 404, { error: 'Member not found' });
    if (req.method === 'PATCH') {
      const body = await parseJsonBody(req); const role = String(body?.role || '');
      if (!['owner', 'admin', 'member'].includes(role)) return json(res, 400, { error: 'Role must be owner, admin, or member' });
      if (target.role === 'owner' && role !== 'owner') {
        const { count } = await supabase.from('tenant_members').select('id', { count: 'exact', head: true }).eq('tenant_id', workspaceId).eq('role', 'owner').eq('status', 'active');
        if ((count || 0) <= 1) return json(res, 409, { error: 'The workspace must retain at least one owner' });
      }
      const { data, error } = await supabase.from('tenant_members').update({ role }).eq('tenant_id', workspaceId).eq('id', memberId).select('id,role').single();
      if (error || !data) return json(res, 500, { error: error?.message || 'Role update failed' });
      await auditLog({ tenantId: workspaceId, userId: auth.userId, action: 'workspace.member_role_updated', resource: `member:${memberId}`, detail: { role }, ip: getClientIp(req) });
      return json(res, 200, { id: data.id, membershipRole: data.role });
    }
    if (req.method === 'DELETE') {
      if (target.user_id === auth.userId) return json(res, 409, { error: 'You cannot remove your own active membership' });
      const { error } = await supabase.from('tenant_members').delete().eq('tenant_id', workspaceId).eq('id', memberId);
      if (error) return json(res, 500, { error: error.message });
      await auditLog({ tenantId: workspaceId, userId: auth.userId, action: 'workspace.member_removed', resource: `member:${memberId}`, detail: {}, ip: getClientIp(req) });
      return json(res, 200, { id: memberId });
    }
    json(res, 405, { error: 'Method not allowed' });
  } catch (error) { json(res, 500, { error: error instanceof Error ? error.message : 'Workspace member request failed' }); }
}

// ── Dashboard ───────────────────────────────────────────────────

async function handleDashboard(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return json(res, 401, { error: 'Authentication required' });
  }

  const { tenantId } = auth;

  try {
    const supabase = createSupabaseAdmin();

    // Parallel queries for dashboard data
    const [tenantResult, activityResult, agentResult] = await Promise.all([
      // Tenant info (plan, store count)
      supabase
        .from('tenants')
        .select('name, plan, store_count, pos_system, onboarding_completed, created_at')
        .eq('id', tenantId)
        .single(),

      // Recent audit log activity for this tenant
      supabase
        .from('audit_log')
        .select('id, action, resource, detail, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(10),

      // Tenant's activated agents (table may not exist yet — catch gracefully)
      supabase
        .from('tenant_agents')
        .select('agent_id, status, last_active_at')
        .eq('tenant_id', tenantId),
    ]);

    const tenant = tenantResult.data;
    const activities = activityResult.data || [];
    const tenantTasks = listTasks(tenantId);

    // Agent stats (graceful if table doesn't exist)
    const agents: Array<{ agent_id: string; status: string; last_active_at: string | null }> =
      agentResult.data || [];
    const activeAgents = agents.filter((a) => a.status === 'active').length;
    const totalAgents = agents.length;
    const statuses: Record<string, number> = {};
    for (const a of agents) {
      statuses[a.status] = (statuses[a.status] || 0) + 1;
    }

    // Map audit_log entries to activity feed
    const activityTypeMap: Record<string, 'success' | 'warning' | 'info' | 'error'> = {
      'signup.completed': 'success',
      'onboarding.completed': 'success',
      'billing.checkout_started': 'info',
      'auth.login_success': 'info',
      'auth.login_failed': 'warning',
      'auth.login_locked': 'error',
      'lead.captured': 'info',
    };

    const recentActivity = activities.map((a: { id: string; action: string; resource: string | null; detail: Record<string, unknown> | null; created_at: string }) => {
      const actionParts = a.action.split('.');
      const agent = actionParts[0] ? actionParts[0].charAt(0).toUpperCase() + actionParts[0].slice(1) : 'System';
      const actionLabel = actionParts.slice(1).join(' ').replace(/_/g, ' ') || a.action;
      const detail = a.detail;
      const description = detail?.email
        ? `${actionLabel} — ${detail.email}`
        : detail?.company
          ? `${actionLabel} — ${detail.company}`
          : actionLabel;

      return {
        id: a.id,
        agent,
        action: description,
        timestamp: timeAgo(a.created_at),
        type: activityTypeMap[a.action] || 'info',
      };
    });

    const humanLayer = buildHumanLayerSnapshot({
      tenantId,
      tenantName: tenant?.name || 'AROS',
      createdAt: tenant?.created_at,
      tasks: tenantTasks,
      recentActivity: activities,
    });

    // Pull live store data if a connector is actually connected (keyed off
    // tenant_connectors, not the tenants.pos_system flag). Null → not
    // connected (or fetch failed) → honest placeholder.
    const storeSummary = await getTenantStoreSummary(tenantId);
    const connected = storeSummary !== null;

    // Build response — real store data when connected, placeholders otherwise
    const dashboard = {
      dataSource: connected
        ? { live: true, connector: storeSummary!.source, fetchedAt: storeSummary!.fetchedAt, partial: storeSummary!.partial }
        : { live: false },
      todaySales: connected
        ? {
            revenue: storeSummary!.todaySales.revenue,
            transactions: storeSummary!.todaySales.transactions,
            changePercent: storeSummary!.todaySales.changePercent,
          }
        : {
            revenue: 0,
            changePercent: 0,
            _note: 'Connect your store to see live sales data',
          },
      activeAlerts: {
        count: connected ? storeSummary!.lowStock.count : 0,
        critical: 0,
      },
      aiAgents: {
        active: activeAgents || (tenant?.plan === 'free' ? 1 : 0),
        total: totalAgents || (tenant?.plan === 'free' ? 2 : tenant?.plan === 'starter' ? 5 : 10),
        statuses: Object.keys(statuses).length > 0 ? statuses : { available: totalAgents || 2 },
      },
      lowStock: connected
        ? { count: storeSummary!.lowStock.count, items: storeSummary!.lowStock.items }
        : {
            count: 0,
            items: [] as Array<{ name: string; current: number; threshold: number }>,
            _note: 'Connect your store to see inventory alerts',
          },
      humanLayer,
      recentActivity: recentActivity.length > 0 ? recentActivity : [
        {
          id: 'welcome',
          agent: 'AROS',
          action: `Welcome to ${tenant?.name || 'AROS'}! Complete setup to see live data here.`,
          timestamp: timeAgo(tenant?.created_at || new Date().toISOString()),
          type: 'info' as const,
        },
      ],
    };

    json(res, 200, dashboard);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch dashboard';
    console.error('[dashboard]', message);
    json(res, 500, { error: message });
  }
}

async function handleHumanBriefing(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return json(res, 401, { error: 'Authentication required' });
  }

  try {
    const supabase = createSupabaseAdmin();
    const [tenantResult, activityResult] = await Promise.all([
      supabase
        .from('tenants')
        .select('name, created_at')
        .eq('id', auth.tenantId)
        .single(),
      supabase
        .from('audit_log')
        .select('action, detail, created_at')
        .eq('tenant_id', auth.tenantId)
        .order('created_at', { ascending: false })
        .limit(12),
    ]);

    const briefing = buildHumanLayerSnapshot({
      tenantId: auth.tenantId,
      tenantName: tenantResult.data?.name || 'AROS',
      createdAt: tenantResult.data?.created_at,
      tasks: listTasks(auth.tenantId),
      recentActivity: (activityResult.data || []).map((row: { action: string; detail: Record<string, unknown> | null; created_at: string }) => row),
    });

    json(res, 200, briefing);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch human briefing';
    console.error('[human-briefing]', message);
    json(res, 500, { error: message });
  }
}

// ── Store Connectors (POS / store data sources) ─────────────────
// Credentials are encrypted server-side (AES-256-GCM) before persisting;
// the plain value never leaves this process and is never returned to clients.
// TODO: move key custody to shre-secrets vault (:5473) once commissioned.

const STORE_CONNECTOR_TYPES = ['rapidrms-api', 'verifone-commander', 'azure-db'] as const;
type StoreConnectorType = (typeof STORE_CONNECTOR_TYPES)[number];

const CONNECTOR_COLUMNS = 'id, tenant_id, type, name, config, status, last_tested, last_error, created_at, updated_at';

let connectorCryptoReady = false;
function ensureConnectorCrypto(): void {
  if (connectorCryptoReady) return;
  // Stable key so credential blobs survive restarts. Without either env var
  // the input-handler falls back to an ephemeral key (dev only).
  const secret = process.env.AROS_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (secret) setEncryptionKey(createHash('sha256').update(secret).digest());
  connectorCryptoReady = true;
}

/** Per-tenant vault key-derivation seed — used by both connector test and data fetch. */
function vaultSecretFor(tenantId: string): string {
  return `${tenantId}:${process.env.AROS_ENCRYPTION_KEY || 'aros-dev'}`;
}

// ── Live store summary (the connector → real-data read-back) ─────
// Short in-memory TTL cache so a dashboard load doesn't re-auth the POS on
// every request. Live pull is the default; a materialized snapshot table is
// the scale path (see docs/store-data-flow.md).
const STORE_SUMMARY_TTL_MS = 60_000;
const storeSummaryCache = new Map<string, { at: number; summary: StoreSummary | null }>();

/**
 * Resolve a tenant's connected connector and return a normalized live summary,
 * or null when the tenant has no connected connector (or its type has no
 * summary mapper yet). Never throws — a fetch failure resolves to null so
 * callers degrade to the honest placeholder.
 */
async function getTenantStoreSummary(tenantId: string): Promise<StoreSummary | null> {
  const cached = storeSummaryCache.get(tenantId);
  if (cached && Date.now() - cached.at < STORE_SUMMARY_TTL_MS) return cached.summary;

  let summary: StoreSummary | null = null;
  try {
    const supabase = createSupabaseAdmin();
    const { data: rows } = await supabase
      .from('tenant_connectors')
      .select(`${CONNECTOR_COLUMNS}, credentials_encrypted`)
      .eq('tenant_id', tenantId)
      .eq('status', 'connected')
      // Prefer a POS (rapidrms) over a raw DB connector for the headline summary.
      .order('type', { ascending: true })
      .limit(5);

    const row = (rows ?? []).find((r) => r.type === 'rapidrms-api') ?? (rows ?? [])[0];
    if (row) {
      ensureConnectorCrypto();
      const secrets = JSON.parse(decryptValue(row.credentials_encrypted)) as Record<string, string>;
      summary = await fetchStoreSummary(
        { id: row.id, type: row.type, name: row.name, config: (row.config ?? {}) as Record<string, unknown>, secrets },
        vaultSecretFor(tenantId),
      );
      // Enrich changePercent from warehouse history (same weekday last week)
      // — null until a week of snapshots exists.
      if (summary && summary.todaySales.changePercent === null) {
        summary = { ...summary, todaySales: { ...summary.todaySales, changePercent: await weekOverWeekChange(supabase, tenantId, summary.todaySales.revenue) } };
      }
    }
  } catch (err) {
    console.error('[store-summary]', err instanceof Error ? err.message : err);
    summary = null;
  }

  storeSummaryCache.set(tenantId, { at: Date.now(), summary });
  return summary;
}

/**
 * Internal service token used by trusted services (e.g. shre-router's
 * data-source-resolver) to fetch a *specific* tenant's summary. Read from env
 * or the vault file; empty string disables the service path entirely
 * (fail-closed — the user-bearer path still works).
 */
function readServiceToken(): string {
  const candidates = [
    process.env.AROS_SERVICE_TOKEN,
    process.env.AROS_INTERNAL_TOKEN,
    '/root/.shre/vault/aros-platform.token',
    (process.env.HOME || '') + '/.shre/vault/aros-platform.token',
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      if (!candidate.startsWith('/')) {
        if (candidate.trim()) return candidate.trim();
        continue;
      }
      if (existsSync(candidate)) {
        const token = readFileSync(candidate, 'utf8').trim();
        if (token) return token;
      }
    } catch { /* try next */ }
  }
  return '';
}

/**
 * Timing-safe token comparison. Hashes both sides to a fixed 32 bytes first,
 * so timingSafeEqual never throws on length mismatch AND no length is leaked.
 */
function tokensMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Callers permitted to use the service path — spoofable header, allow-listed for audit clarity. */
const ALLOWED_SERVICE_SOURCES = new Set(['shre-router']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UTC business date (YYYY-MM-DD) offset by `daysAgo`. */
function businessDate(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/** % change vs the snapshot from 7 days ago; null if no comparable history. */
async function weekOverWeekChange(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  tenantId: string,
  todayRevenue: number,
): Promise<number | null> {
  try {
    const { data: prior } = await supabase
      .from('store_snapshots')
      .select('revenue')
      .eq('tenant_id', tenantId)
      .eq('business_date', businessDate(7))
      .maybeSingle();
    const priorRevenue = prior && typeof prior.revenue === 'number' ? prior.revenue : null;
    if (priorRevenue === null || priorRevenue <= 0) return null;
    return Math.round(((todayRevenue - priorRevenue) / priorRevenue) * 1000) / 10;
  } catch {
    return null;
  }
}

/**
 * Warehouse snapshotter: pull each connected connector's live summary and
 * upsert today's snapshot row. Scheduled (env-gated) so the self-serve
 * connector path accrues history — real trends + changePercent — rather than
 * being live-pull-only. Per-tenant failures are isolated.
 */
async function captureStoreSnapshots(): Promise<{ captured: number; failed: number; skipped: number }> {
  const supabase = createSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from('tenant_connectors')
    .select(`${CONNECTOR_COLUMNS}, credentials_encrypted`)
    .eq('status', 'connected');
  if (error) {
    console.error('[snapshot] connector query failed:', error.message);
    return { captured: 0, failed: 0, skipped: 0 };
  }

  // One connector per tenant for the headline snapshot (POS preferred).
  const byTenant = new Map<string, (typeof rows)[number]>();
  for (const r of rows ?? []) {
    const cur = byTenant.get(r.tenant_id);
    if (!cur || (r.type === 'rapidrms-api' && cur.type !== 'rapidrms-api')) byTenant.set(r.tenant_id, r);
  }

  let captured = 0, failed = 0, skipped = 0;
  const today = businessDate();
  for (const [tenantId, row] of byTenant) {
    try {
      ensureConnectorCrypto();
      const secrets = JSON.parse(decryptValue(row.credentials_encrypted)) as Record<string, string>;
      const summary = await fetchStoreSummary(
        { id: row.id, type: row.type, name: row.name, config: (row.config ?? {}) as Record<string, unknown>, secrets },
        vaultSecretFor(tenantId),
      );
      if (!summary) { skipped++; continue; } // unsupported connector type
      // A partial summary's zeros are fetch failures, not facts — never let
      // them enter trend history (they'd poison week-over-week forever).
      if (summary.partial) { skipped++; continue; }
      const { error: upErr } = await supabase.from('store_snapshots').upsert({
        tenant_id: tenantId,
        connector_id: row.id,
        business_date: today,
        captured_at: new Date().toISOString(),
        revenue: summary.todaySales.revenue,
        transactions: summary.todaySales.transactions,
        low_stock_count: summary.lowStock.count,
        low_stock_items: summary.lowStock.items,
        source: summary.source,
        partial: summary.partial,
      }, { onConflict: 'tenant_id,business_date' });
      if (upErr) throw new Error(upErr.message);
      storeSummaryCache.delete(tenantId); // fresh data on next read
      // Replicate into the shared CortexDB warehouse (opt-in, fire-and-forget).
      void replicateSnapshotToCortex({
        tenantId,
        connectorId: row.id,
        businessDate: today,
        revenue: summary.todaySales.revenue,
        transactions: summary.todaySales.transactions,
        lowStockCount: summary.lowStock.count,
        source: summary.source,
        partial: summary.partial,
      });
      captured++;
    } catch (err) {
      failed++;
      console.error('[snapshot] tenant', tenantId, err instanceof Error ? err.message : err);
    }
  }
  return { captured, failed, skipped };
}

async function handleStoreSummary(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // ── Service-to-service path ──────────────────────────────────
  // A trusted internal caller (shre-router) may request a SPECIFIC tenant's
  // summary with the service token + an explicit tenantId. That caller is
  // responsible for having already authorized the end user for that tenant
  // (the router does this via checkTenantBinding + canAccessData). This
  // endpoint is a trusted data provider, NOT the tenant-authorization
  // boundary — so the service path never runs off an end-user's identity.
  const serviceToken = readServiceToken();
  const presentedToken = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const rawSource = req.headers['x-service-source'];
  const serviceSource = Array.isArray(rawSource) ? rawSource[0] : rawSource;
  const claimsService = Boolean(serviceSource) && ALLOWED_SERVICE_SOURCES.has(String(serviceSource));
  if (serviceToken && claimsService && tokensMatch(presentedToken, serviceToken)) {
    const tenantId = getRequestUrl(req).searchParams.get('tenantId');
    if (!tenantId) {
      return json(res, 400, { error: 'tenantId query param required for service requests' });
    }
    // Defence-in-depth: only real tenant UUIDs. A non-UUID id (e.g. a POS
    // store slug 'client-2' that the router might derive from prompt text)
    // can never reach a tenant's data through this path.
    if (!UUID_RE.test(tenantId)) {
      return json(res, 400, { error: 'tenantId must be a valid tenant UUID' });
    }
    const summary = await getTenantStoreSummary(tenantId);
    // Audit every service-path read — the service token is powerful (any
    // tenant); make its use traceable (source + tenant, never the token).
    void auditLog({
      tenantId,
      action: 'store.summary.service_read',
      resource: tenantId,
      detail: { source: String(serviceSource) },
      ip: getClientIp(req),
    });
    return json(res, 200, summary ? { connected: true, summary } : { connected: false, summary: null });
  }

  // ── End-user path ────────────────────────────────────────────
  // A user's Supabase bearer resolves ONLY to their own tenant — a user can
  // never request another tenant's summary here.
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  const summary = await getTenantStoreSummary(auth.tenantId);
  if (summary) return json(res, 200, { connected: true, summary });
  // No live summary. `connected` keeps its strict meaning (live data actually
  // fetched — onboarding readiness depends on it); the extra fields let the
  // dashboard distinguish "no connector" from "connector saved, numbers not
  // available (yet or ever)" instead of telling a connected owner to connect.
  // Service path above is unchanged.
  const { hasConnector, summaryCapable } = await connectedConnectorState(auth.tenantId);
  json(res, 200, { connected: false, summary: null, hasConnector, summaryCapable });
}

/**
 * Whether the tenant has any connected connector row, and whether any of them
 * is a type that can ever produce a live summary (hasSummaryMapper).
 */
async function connectedConnectorState(tenantId: string): Promise<{ hasConnector: boolean; summaryCapable: boolean }> {
  try {
    const supabase = createSupabaseAdmin();
    const { data: rows } = await supabase
      .from('tenant_connectors')
      .select('type')
      .eq('tenant_id', tenantId)
      .eq('status', 'connected')
      .limit(10);
    const types = (rows ?? []).map((r) => String(r.type));
    return { hasConnector: types.length > 0, summaryCapable: types.some(hasSummaryMapper) };
  } catch {
    return { hasConnector: false, summaryCapable: false };
  }
}

// ── Weekly Owner Brief (digest) — proxy to the shre-rapidrms warehouse ──
// The owner-digest engine (shre-rapidrms, docs/planning/OWNER-DIGEST-PLAN.md)
// persists one brief per (provider, store_id) over the shre.* gold views and
// serves it at GET /api/digest/latest. This proxy resolves the authenticated
// tenant to that scope and forwards — strictly read-only and fail-soft: any
// upstream problem degrades to { digest: null } with HTTP 200 so the Home
// card simply doesn't render. It must never break Home/onboarding.

interface DigestScope { provider: string; storeId: string }

/**
 * Tenant → warehouse digest scope. The warehouse keys stores by
 * (provider, provider_store_id); for RapidRMS its canonical map derives
 * provider_store_id as `'client-' || client_id` (shre-rapidrms
 * src/canonical/map-rapidrms.mjs), and the tenant's client id lives on the
 * `rapidrms-api` connector row's config.clientId — the same row every other
 * store-scoped read here (summary / sales / EDI) resolves through.
 * Verifone/Azure connectors have no canonical map yet, so they resolve to
 * null (no digest) rather than a guessed scope.
 */
async function resolveDigestScope(tenantId: string): Promise<DigestScope | null> {
  try {
    const supabase = createSupabaseAdmin();
    const { data: rows } = await supabase
      .from('tenant_connectors')
      .select('type, config')
      .eq('tenant_id', tenantId)
      .eq('type', 'rapidrms-api')
      .eq('status', 'connected')
      .limit(1);
    const row = rows?.[0];
    if (!row) return null;
    const config = (row.config ?? {}) as Record<string, unknown>;
    const clientId = String(config.clientId ?? '').trim();
    if (!clientId) return null;
    return { provider: 'rapidrms', storeId: clientId.startsWith('client-') ? clientId : `client-${clientId}` };
  } catch (err) {
    console.error('[owner-digest] scope resolution failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Small TTL cache (same pattern as storeSummaryCache) so a Home load doesn't
// re-hit the warehouse every render, and an unreachable upstream doesn't add
// a timeout wait to every request for the next minute.
const OWNER_DIGEST_TTL_MS = 60_000;
const ownerDigestCache = new Map<string, { at: number; body: Record<string, unknown> }>();

async function handleOwnerDigest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });

  const cached = ownerDigestCache.get(auth.tenantId);
  if (cached && Date.now() - cached.at < OWNER_DIGEST_TTL_MS) return json(res, 200, cached.body);

  // Fail-soft contract: always 200, always a `digest` key. `null` means
  // "nothing to show" (no POS mapped, or no digest built yet); the optional
  // `error: 'unavailable'` marks a transient upstream failure.
  let body: Record<string, unknown> = { digest: null };
  try {
    const scope = await resolveDigestScope(auth.tenantId);
    if (scope) {
      const upstream = await fetch(
        `${SHRE_RAPIDRMS_URL}/api/digest/latest?provider=${encodeURIComponent(scope.provider)}&store_id=${encodeURIComponent(scope.storeId)}`,
        { signal: AbortSignal.timeout(5000), headers: digestHeaders() },
      );
      if (upstream.ok) {
        const row = (await upstream.json()) as Record<string, unknown> | null;
        if (row && typeof row === 'object' && row.digest) body = row;
      } else if (upstream.status !== 404) {
        // 404 = no digest generated yet — an expected, quiet state.
        body = { digest: null, error: 'unavailable' };
      }
    }
  } catch (err) {
    console.error('[owner-digest]', err instanceof Error ? err.message : err);
    body = { digest: null, error: 'unavailable' };
  }
  ownerDigestCache.set(auth.tenantId, { at: Date.now(), body });
  json(res, 200, body);
}

/**
 * Day-0 first-run digest (OWNER-DIGEST-PLAN Phase 2): the moment a POS
 * connector activates, ask the warehouse to build this store's first brief so
 * Home gets a Weekly Brief card without waiting for Monday's weekly job.
 * Strictly fire-and-forget — every failure is logged and swallowed; connector
 * activation must never depend on the digest engine being reachable.
 */
async function requestFirstRunDigest(tenantId: string): Promise<void> {
  try {
    const scope = await resolveDigestScope(tenantId);
    if (!scope) return;
    const upstream = await fetch(`${SHRE_RAPIDRMS_URL}/api/digest/generate`, {
      method: 'POST',
      headers: digestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ provider: scope.provider, store_id: scope.storeId }),
      signal: AbortSignal.timeout(60_000),
    });
    if (upstream.ok) ownerDigestCache.delete(tenantId);
    console.log(`[owner-digest] first-run generate ${scope.provider}/${scope.storeId} for tenant ${tenantId}: ${upstream.status}`);
  } catch (err) {
    console.error('[owner-digest] first-run generate failed:', err instanceof Error ? err.message : err);
  }
}

async function handleStoreSales(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  const request = getRequestUrl(req);
  let tenantId = auth?.tenantId || '';
  if (!auth) {
    const serviceToken = readServiceToken();
    const presented = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const source = Array.isArray(req.headers['x-service-source']) ? req.headers['x-service-source'][0] : req.headers['x-service-source'];
    tenantId = request.searchParams.get('tenantId') || '';
    if (!serviceToken || source !== 'shre-router' || !tokensMatch(presented, serviceToken) || !UUID_RE.test(tenantId)) return json(res, 401, { error: 'Authentication required' });
  }
  const to = request.searchParams.get('to') || businessDate();
  const from = request.searchParams.get('from') || to;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return json(res, 400, { error: 'from and to must be a valid date range' });
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > 31) return json(res, 413, { error: 'Interactive sales queries are limited to 31 days. Start a historical sync for larger ranges.' });
  try {
    const supabase = createSupabaseAdmin();
    const { data: rows } = await supabase.from('tenant_connectors').select(`${CONNECTOR_COLUMNS}, credentials_encrypted`).eq('tenant_id', tenantId).eq('type', 'rapidrms-api').eq('status', 'connected').limit(1);
    const row = rows?.[0];
    if (!row) return json(res, 404, { error: 'No healthy RapidRMS connection is mapped to this workspace' });
    ensureConnectorCrypto();
    const secrets = JSON.parse(decryptValue(row.credentials_encrypted)) as Record<string, string>;
    const daily = await fetchStoreSalesRange({ id: row.id, type: row.type, name: row.name, config: row.config || {}, secrets }, vaultSecretFor(tenantId), from, to);
    for (const day of daily) {
      await supabase.from('store_snapshots').upsert({ tenant_id: tenantId, connector_id: row.id, business_date: day.businessDate, captured_at: new Date().toISOString(), revenue: day.revenue, transactions: day.transactions, low_stock_count: 0, low_stock_items: [], source: { type: row.type, name: row.name }, partial: false }, { onConflict: 'tenant_id,business_date' });
      void replicateSnapshotToCortex({ tenantId, connectorId: row.id, businessDate: day.businessDate, revenue: day.revenue, transactions: day.transactions, lowStockCount: 0, source: { type: row.type, name: row.name }, partial: false });
    }
    const totals = daily.reduce((sum, day) => ({ revenue: sum.revenue + day.revenue, transactions: sum.transactions + day.transactions }), { revenue: 0, transactions: 0 });
    await auditLog({ tenantId, userId: auth?.userId, action: 'store.sales.read', resource: `connector:${row.id}`, detail: { from, to, days: daily.length, source: auth ? 'user' : 'shre-router' }, ip: getClientIp(req) });
    json(res, 200, { store: row.name, from, to, daily, totals: { revenue: Math.round(totals.revenue * 100) / 100, transactions: totals.transactions, averageTicket: totals.transactions ? Math.round((totals.revenue / totals.transactions) * 100) / 100 : 0 }, source: 'RapidRMS API', fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[store-sales]', err instanceof Error ? err.message : err);
    json(res, 502, { error: 'RapidRMS sales data could not be retrieved' });
  }
}

const APP_CAPABILITY_BUNDLES: Record<string, { tools: string[]; skills: Array<{ name: string; capabilities: string[] }>; agents: Array<{ name: string; capabilities: string[] }> }> = {
  storepulse: {
    tools: ['mib_sales_today', 'mib_sales_summary', 'mib_top_items', 'mib_item_search', 'mib_low_inventory'],
    skills: [
      { name: 'Daily Sales Summary', capabilities: ['pos.sales.read'] },
      { name: 'Inventory Health', capabilities: ['pos.inventory.read'] },
      { name: 'Store Performance', capabilities: ['stores.read', 'pos.sales.read'] },
    ],
    // Agent names match the provisioning-manifest seeds so both systems
    // converge on the same tenant_resources rows.
    agents: [{ name: 'Retail Analyst Agent', capabilities: ['pos.sales.read', 'pos.inventory.read', 'analytics.insights'] }],
  },
  mib: { tools: ['mib_get_workspace', 'mib_list_agents', 'mib_list_tasks'], skills: [{ name: 'Workspace Operations', capabilities: ['workspace.admin'] }], agents: [] },
  centrix: { tools: ['centrix_search_contacts', 'centrix_list_contacts', 'centrix_list_tasks', 'centrix_list_deals'], skills: [{ name: 'Customer Operations', capabilities: ['crm.read', 'tasks.read'] }], agents: [{ name: 'Customer Operations Agent', capabilities: ['crm.read', 'tasks.read'] }] },
};

const CONNECTOR_CAPABILITY_TOOLS: Record<string, string[]> = {
  'rapidrms-api': ['mib_sales_today', 'mib_sales_summary', 'mib_top_items', 'mib_store_list', 'mib_item_search', 'mib_low_inventory', 'mib_invoices', 'rapidrms_storepulse'],
  'verifone-commander': ['mib_sales_today', 'mib_sales_summary', 'mib_top_items', 'mib_store_list', 'mib_item_search', 'mib_low_inventory', 'mib_invoices'],
};

async function handleWorkspaceCapabilities(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const serviceToken = readServiceToken();
  const presented = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const source = Array.isArray(req.headers['x-service-source']) ? req.headers['x-service-source'][0] : req.headers['x-service-source'];
  const tenantId = getRequestUrl(req).searchParams.get('tenantId') || '';
  if (!serviceToken || source !== 'shre-router' || !tokensMatch(presented, serviceToken) || !UUID_RE.test(tenantId)) return json(res, 401, { error: 'Authentication required' });
  const supabase = createSupabaseAdmin();
  const [{ data: grants, error: grantError }, { data: resources, error: resourceError }, { data: connectors, error: connectorError }] = await Promise.all([
    supabase.from('marketplace_app_entitlements').select('app_key,status,service_config').eq('tenant_id', tenantId).eq('status', 'active'),
    supabase.from('tenant_resources').select('kind,provider,name,status,capabilities,config,store_ids').eq('tenant_id', tenantId).eq('status', 'active'),
    supabase.from('tenant_connectors').select('type,status').eq('tenant_id', tenantId).eq('status', 'connected'),
  ]);
  if (grantError || resourceError || connectorError) return json(res, 500, { error: grantError?.message || resourceError?.message || connectorError?.message });
  const appKeys = (grants || []).map(grant => String(grant.app_key));
  const connectorTypes = (connectors || []).map(connector => String(connector.type));
  const tools = [...new Set([
    ...appKeys.flatMap(appKey => APP_CAPABILITY_BUNDLES[appKey]?.tools || []),
    ...connectorTypes.flatMap(type => CONNECTOR_CAPABILITY_TOOLS[type] || []),
  ])];
  await auditLog({ tenantId, action: 'workspace.capabilities.service_read', resource: tenantId, detail: { source, apps: appKeys.length, connectors: connectorTypes.length, tools: tools.length }, ip: getClientIp(req) });
  json(res, 200, { tenantId, apps: grants || [], resources: resources || [], tools, generatedAt: new Date().toISOString() });
}

function routerModelId(provider: string, model: string): string {
  if (model.includes('/')) return model;
  if (provider === 'aum') return model === 'shre-70b' ? 'aum/70b' : `aum/${model}`;
  const prefix = provider === 'google' ? 'google' : provider;
  return `${prefix}/${model}`;
}

async function handleModelSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  const supabase = createSupabaseAdmin();
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('tenant_resources').select('id,provider,name,status,config,health').eq('tenant_id', auth.tenantId).eq('kind', 'model').order('created_at');
    if (error) return json(res, 500, { error: error.message });
    const providers = (data || []).map(row => ({ id: row.id, provider: row.provider, label: row.name, model: row.config?.modelId, endpoint: row.config?.endpoint, isActive: row.status === 'active', status: row.status, verification: row.health }));
    return json(res, 200, { providers, active: providers.find(provider => provider.isActive)?.id || null });
  }
  if (!['owner', 'admin'].includes(auth.role)) return json(res, 403, { error: 'Workspace admin access required' });
  const body = await parseJsonBody(req);
  if (!body || !Array.isArray(body.providers)) return json(res, 400, { error: 'providers are required' });
  const selected = body.providers.find((provider: Record<string, unknown>) => String(provider.id) === String(body.active)) || body.providers.find((provider: Record<string, unknown>) => provider.isActive === true);
  if (!selected) return json(res, 400, { error: 'Select an active model provider' });
  const provider = String(selected.provider || '').toLowerCase();
  const model = String(selected.model || '').trim();
  if (!['aum', 'ollama', 'anthropic', 'openai', 'google'].includes(provider) || !model) return json(res, 400, { error: 'Unsupported provider or model' });
  const modelId = routerModelId(provider, model);
  const apiKey = typeof selected.apiKey === 'string' ? selected.apiKey.trim() : '';
  const credentialMode = apiKey ? 'api_key' : 'system_provider';
  const routerResponse = await fetch(`${SHRE_ROUTER_URL}/v1/model-onboarding/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '', 'x-tenant-id': auth.tenantId, 'x-user-id': auth.userId },
    body: JSON.stringify({ tenantId: auth.tenantId, userId: auth.userId, agentId: 'aros-agent', modelId, credentialMode, apiKey: apiKey || undefined, autoUpgrade: true }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await routerResponse.json().catch(() => ({})) as Record<string, unknown>;
  const verified = routerResponse.ok && (result.verification as Record<string, unknown> | undefined)?.verified !== false;
  const { error } = await supabase.from('tenant_resources').upsert({
    tenant_id: auth.tenantId, kind: 'model', provider, name: String(selected.label || model), status: verified ? 'active' : 'failed',
    capabilities: ['chat.completions', 'tools'], config: { modelId, endpoint: selected.endpoint || null, credentialMode },
    health: { state: verified ? 'verified' : 'failed', checkedAt: new Date().toISOString(), detail: verified ? 'Provider verified by MIB router' : String(result.error || 'Provider verification failed') }, created_by: auth.userId,
  }, { onConflict: 'tenant_id,kind,name' });
  if (error) return json(res, 500, { error: error.message });
  await auditLog({ tenantId: auth.tenantId, userId: auth.userId, action: 'model.provider.configured', resource: `model:${modelId}`, detail: { provider, modelId, credentialMode, verified }, ip: getClientIp(req) });
  json(res, routerResponse.ok ? 200 : 409, verified ? { providers: [{ ...selected, apiKey: undefined, model: modelId, isActive: true }], active: selected.id, verification: result.verification } : { error: String(result.error || 'Model verification failed'), verification: result.verification });
}

const runningStoreSyncs = new Set<string>();
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (value: string, days: number) => isoDate(new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000));

async function runStoreSync(jobId: string): Promise<void> {
  if (runningStoreSyncs.has(jobId)) return;
  runningStoreSyncs.add(jobId);
  const supabase = createSupabaseAdmin();
  try {
    const { data: job, error: jobError } = await supabase.from('store_sync_jobs').select('*').eq('id', jobId).single();
    if (jobError || !job || job.status === 'cancelled' || job.status === 'completed') return;
    const { data: row, error: connectorError } = await supabase.from('tenant_connectors').select(`${CONNECTOR_COLUMNS}, credentials_encrypted`).eq('id', job.connector_id).eq('tenant_id', job.tenant_id).eq('type', 'rapidrms-api').eq('status', 'connected').single();
    if (connectorError || !row) throw new Error('The RapidRMS connector is no longer healthy');
    await supabase.from('store_sync_jobs').update({ status: 'running', started_at: job.started_at || new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('id', jobId);
    ensureConnectorCrypto();
    const secrets = JSON.parse(decryptValue(row.credentials_encrypted)) as Record<string, string>;
    const totalDays = Math.round((Date.parse(`${job.to_date}T00:00:00Z`) - Date.parse(`${job.from_date}T00:00:00Z`)) / 86_400_000) + 1;
    let cursor = String(job.cursor_date);
    let daysSynced = Number(job.days_synced || 0);
    while (cursor <= job.to_date) {
      const { data: current } = await supabase.from('store_sync_jobs').select('status').eq('id', jobId).single();
      if (current?.status === 'cancelled') return;
      const chunkTo = [addDays(cursor, Number(job.chunk_days) - 1), String(job.to_date)].sort()[0];
      const daily = await fetchStoreSalesRange({ id: row.id, type: row.type, name: row.name, config: row.config || {}, secrets }, vaultSecretFor(job.tenant_id), cursor, chunkTo);
      for (const day of daily) {
        const snapshot = { tenant_id: job.tenant_id, connector_id: row.id, business_date: day.businessDate, captured_at: new Date().toISOString(), revenue: day.revenue, transactions: day.transactions, low_stock_count: 0, low_stock_items: [], source: { type: row.type, name: row.name }, partial: false };
        const { error } = await supabase.from('store_snapshots').upsert(snapshot, { onConflict: 'tenant_id,business_date' });
        if (error) throw error;
        void replicateSnapshotToCortex({ tenantId: job.tenant_id, connectorId: row.id, businessDate: day.businessDate, revenue: day.revenue, transactions: day.transactions, lowStockCount: 0, source: snapshot.source, partial: false });
      }
      const chunkDays = Math.round((Date.parse(`${chunkTo}T00:00:00Z`) - Date.parse(`${cursor}T00:00:00Z`)) / 86_400_000) + 1;
      daysSynced += chunkDays;
      cursor = addDays(chunkTo, 1);
      await supabase.from('store_sync_jobs').update({ cursor_date: cursor, days_synced: daysSynced, progress: Math.min(99, Math.round(daysSynced / totalDays * 100)), updated_at: new Date().toISOString() }).eq('id', jobId);
    }
    await supabase.from('store_sync_jobs').update({ status: 'completed', progress: 100, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', jobId);
    storeSummaryCache.delete(job.tenant_id);
  } catch (err) {
    await supabase.from('store_sync_jobs').update({ status: 'failed', last_error: err instanceof Error ? err.message.slice(0, 500) : 'Historical sync failed', updated_at: new Date().toISOString() }).eq('id', jobId);
    console.error('[store-sync]', jobId, err instanceof Error ? err.message : err);
  } finally {
    runningStoreSyncs.delete(jobId);
  }
}

async function handleStoreSync(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  const supabase = createSupabaseAdmin();
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('store_sync_jobs').select('id,connector_id,from_date,to_date,cursor_date,chunk_days,status,progress,days_synced,last_error,started_at,completed_at,created_at,updated_at').eq('tenant_id', auth.tenantId).order('created_at', { ascending: false }).limit(20);
    if (error) return json(res, 500, { error: error.message });
    const jobs = await Promise.all((data || []).map(async job => {
      const { count } = await supabase.from('store_snapshots').select('business_date', { count: 'exact', head: true }).eq('tenant_id', auth.tenantId).eq('connector_id', job.connector_id).gte('business_date', job.from_date).lte('business_date', job.to_date);
      return { ...job, rows_imported: count || 0 };
    }));
    return json(res, 200, { jobs });
  }
  if (!canManageMarketplace(auth.role)) return json(res, 403, { error: 'Owner or admin role required' });
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });
  const months = Math.max(1, Math.min(36, Number(body.months || 12)));
  const to = typeof body.to === 'string' ? body.to : businessDate();
  const defaultFrom = new Date(`${to}T00:00:00Z`); defaultFrom.setUTCMonth(defaultFrom.getUTCMonth() - months);
  const from = typeof body.from === 'string' ? body.from : isoDate(defaultFrom);
  const chunkDays = Math.max(1, Math.min(31, Number(body.chunkDays || 7)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return json(res, 400, { error: 'Invalid historical date range' });
  const { data: connector } = await supabase.from('tenant_connectors').select('id').eq('tenant_id', auth.tenantId).eq('type', 'rapidrms-api').eq('status', 'connected').limit(1).maybeSingle();
  if (!connector) return json(res, 409, { error: 'Connect and test a RapidRMS store before starting history sync' });
  const { data: existing } = await supabase.from('store_sync_jobs').select('id,status').eq('tenant_id', auth.tenantId).in('status', ['queued','running']).limit(1).maybeSingle();
  if (existing) return json(res, 409, { error: 'A historical sync is already active', job: existing });
  const { data: job, error } = await supabase.from('store_sync_jobs').insert({ tenant_id: auth.tenantId, connector_id: connector.id, from_date: from, to_date: to, cursor_date: from, chunk_days: chunkDays }).select('*').single();
  if (error || !job) return json(res, 500, { error: error?.message || 'Could not create sync job' });
  void runStoreSync(job.id);
  json(res, 202, { job });
}

function validateConnectorInput(
  type: StoreConnectorType,
  config: Record<string, unknown>,
  secrets: Record<string, unknown>,
): string | null {
  const missing = (fields: string[], source: Record<string, unknown>, label: string) =>
    fields.filter((f) => typeof source[f] !== 'string' || !(source[f] as string).trim()).map((f) => `${label}.${f}`);

  let gaps: string[] = [];
  if (type === 'rapidrms-api') {
    gaps = [...missing(['clientId'], config, 'config'), ...missing(['email', 'password'], secrets, 'secrets')];
  } else if (type === 'verifone-commander') {
    gaps = [...missing(['commanderIp', 'username'], config, 'config'), ...missing(['password'], secrets, 'secrets')];
  } else if (type === 'azure-db') {
    gaps = [...missing(['server', 'database', 'username'], config, 'config'), ...missing(['password'], secrets, 'secrets')];
  }
  return gaps.length ? `Missing required fields: ${gaps.join(', ')}` : null;
}

async function handleConnectorsList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from('tenant_connectors')
      .select(CONNECTOR_COLUMNS)
      .eq('tenant_id', auth.tenantId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    json(res, 200, { connectors: data || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list connectors';
    console.error('[connectors.list]', message);
    json(res, 500, { error: message });
  }
}

async function handleConnectorsCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  if (!canManageMarketplace(auth.role)) return json(res, 403, { error: 'Owner or admin role required' });

  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const type = String(body.type || '') as StoreConnectorType;
  if (!STORE_CONNECTOR_TYPES.includes(type)) {
    return json(res, 400, { error: `Invalid connector type. Expected one of: ${STORE_CONNECTOR_TYPES.join(', ')}` });
  }
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  if (!name) return json(res, 400, { error: 'Missing required field: name' });

  const config = isRecord(body.config) ? body.config : {};
  const secrets = isRecord(body.secrets) ? body.secrets : {};
  const validationError = validateConnectorInput(type, config, secrets);
  if (validationError) return json(res, 400, { error: validationError });

  try {
    ensureConnectorCrypto();
    const supabase = createSupabaseAdmin();
    const payload = {
      tenant_id: auth.tenantId,
      type,
      name,
      config,
      credentials_encrypted: encryptValue(JSON.stringify(secrets)),
      status: 'pending',
      last_error: null,
      created_by: auth.userId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('tenant_connectors')
      .upsert(payload, { onConflict: 'tenant_id,name' })
      .select(CONNECTOR_COLUMNS)
      .single();

    if (error) throw error;

    await auditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'connector.saved',
      resource: name,
      detail: { type },
      ip: getClientIp(req),
    });

    json(res, 200, { ok: true, connector: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save connector';
    console.error('[connectors.create]', message);
    json(res, 500, { error: message });
  }
}

async function handleConnectorsTest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });

  const body = await parseJsonBody(req);
  const id = body && typeof body.id === 'string' ? body.id : null;
  if (!id) return json(res, 400, { error: 'Missing required field: id' });

  const supabase = createSupabaseAdmin();
  const { data: row, error: loadError } = await supabase
    .from('tenant_connectors')
    .select(`${CONNECTOR_COLUMNS}, credentials_encrypted`)
    .eq('tenant_id', auth.tenantId)
    .eq('id', id)
    .single();

  if (loadError || !row) return json(res, 404, { error: 'Connector not found' });

  const refs: string[] = [];
  try {
    ensureConnectorCrypto();
    const secrets = JSON.parse(decryptValue(row.credentials_encrypted)) as Record<string, string>;
    const config = (row.config ?? {}) as Record<string, any>;

    // Bridge decrypted secrets into the connector vault for this test only.
    const tenantVaultSecret = vaultSecretFor(auth.tenantId);
    setTenantSecret(tenantVaultSecret);
    const passwordRef = await storeCredential(`${row.id}:password`, secrets.password ?? '', tenantVaultSecret);
    refs.push(passwordRef);

    let result;
    if (row.type === 'rapidrms-api') {
      const emailRef = await storeCredential(`${row.id}:email`, secrets.email ?? '', tenantVaultSecret);
      refs.push(emailRef);
      result = await testRapidRmsConnector(
        {
          baseUrl: String(config.baseUrl || 'https://rapidrmsapi.azurewebsites.net'),
          clientId: String(config.clientId || ''),
          sessionTimeout: Number(config.sessionTimeout) || 420,
        },
        emailRef,
        passwordRef,
      );
    } else if (row.type === 'azure-db') {
      result = await testAzureDbConnector(
        {
          server: String(config.server || ''),
          database: String(config.database || ''),
          username: String(config.username || ''),
          port: Number(config.port) || 1433,
          ssl: true,
          encrypt: true,
        },
        passwordRef,
      );
    } else {
      result = await testVerifoneConnector(
        {
          commanderIp: String(config.commanderIp || ''),
          username: String(config.username || ''),
          syncIntervalMs: Number(config.syncIntervalMs) || 300_000,
          siteName: row.name,
        },
        passwordRef,
      );
    }

    await supabase
      .from('tenant_connectors')
      .update({
        status: result.success ? 'connected' : 'error',
        last_tested: result.testedAt,
        last_error: result.success ? null : (result.error ?? 'Connection test failed'),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    if (result.success) {
      await setOnboardingComponent(auth.tenantId, 'store', 'ready', {
        connectorId: row.id, connectorType: row.type,
      });
      await setOnboardingComponent(auth.tenantId, 'sync', 'pending', { connectorId: row.id });
      // Day-0 brief: kick the digest engine now that a store is connected, so
      // the owner's first Home visit already has a Weekly Brief. Fire-and-
      // forget — see requestFirstRunDigest; never blocks or fails activation.
      void requestFirstRunDigest(auth.tenantId);
    } else {
      await setOnboardingComponent(auth.tenantId, 'store', 'error', { connectorId: row.id }, result.error ?? 'Connection test failed');
    }
    // A newly-connected (or newly-broken) connector should reflect on the
    // dashboard immediately, not after the summary TTL expires.
    storeSummaryCache.delete(auth.tenantId);

    // Echo a recognizable live detail with success ("we found your store —
    // N transactions today") so the user can sanity-check it against their
    // register. Best-effort: a failed echo never fails the test response.
    // A partial summary is excluded — its zeros are fetch failures, and a
    // confident "0 transactions today" built on one would be a lie.
    let found: { store: string; transactionsToday: number } | null = null;
    if (result.success && hasSummaryMapper(row.type)) {
      try {
        const summary = await fetchStoreSummary(
          { id: row.id, type: row.type, name: row.name, config: (row.config ?? {}) as Record<string, unknown>, secrets },
          vaultSecretFor(auth.tenantId),
        );
        if (summary && !summary.partial) {
          found = {
            store: summary.source.name || row.name,
            transactionsToday: summary.todaySales.transactions,
          };
        }
      } catch { /* optional detail; the connection test itself already passed */ }
    }

    json(res, 200, found ? { ok: true, result, found } : { ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection test failed';
    console.error('[connectors.test]', message);
    json(res, 500, { error: message });
  } finally {
    // Never leave test credentials in the in-memory vault.
    await Promise.all(refs.map((ref) => deleteCredential(ref).catch(() => {})));
  }
}

async function handleConnectorsDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  if (!canManageMarketplace(auth.role)) return json(res, 403, { error: 'Owner or admin role required' });

  const id = getRequestUrl(req).searchParams.get('id');
  if (!id) return json(res, 400, { error: 'Missing required query param: id' });

  try {
    const supabase = createSupabaseAdmin();
    const { error } = await supabase
      .from('tenant_connectors')
      .delete()
      .eq('tenant_id', auth.tenantId)
      .eq('id', id);

    if (error) throw error;

    storeSummaryCache.delete(auth.tenantId);

    await auditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'connector.removed',
      resource: id,
      detail: {},
      ip: getClientIp(req),
    });

    json(res, 200, { ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to remove connector';
    console.error('[connectors.delete]', message);
    json(res, 500, { error: message });
  }
}

// ── RapidRMS EDI (native invoice API — SAME login as the connector) ──────
// EDI reuses the tenant's existing 'rapidrms-api' connector row: its clientId +
// stored email/password. The end user never handles the RapidRMS token — the
// server re-authenticates on their behalf (against the resolved EDI base URL,
// staging by default) for each request and discards the derived vault refs
// after. No new connector type is needed; no schema change.

/** Whether per-request EDI base-URL overrides are honored (dev/non-prod only). */
function ediOverrideAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Resolve the caller's tenant RapidRMS connector, build a short-lived EDI
 * session against the resolved (staging-by-default) base URL, run `fn`, and
 * always tear down the temporary credential refs. Throws a caller-friendly
 * error when no RapidRMS connector is configured.
 */
async function withTenantEdiSession<T>(
  tenantId: string,
  apiUrlOverride: string | null,
  fn: (session: RapidRmsSession, ediBaseUrl: string) => Promise<T>,
): Promise<T> {
  const supabase = createSupabaseAdmin();
  const { data: rows } = await supabase
    .from('tenant_connectors')
    .select(`${CONNECTOR_COLUMNS}, credentials_encrypted`)
    .eq('tenant_id', tenantId)
    .eq('type', 'rapidrms-api')
    .order('status', { ascending: true }) // 'connected' sorts before pending/error
    .limit(5);
  const row = (rows ?? []).find((r) => r.status === 'connected') ?? (rows ?? [])[0];
  if (!row) throw new Error('No RapidRMS connection is configured for this workspace');

  ensureConnectorCrypto();
  const secrets = JSON.parse(decryptValue(row.credentials_encrypted)) as Record<string, string>;
  const config = (row.config ?? {}) as Record<string, unknown>;
  const clientId = String(config.clientId || '');
  if (!clientId) throw new Error('RapidRMS connection is missing its Client ID');

  const ediVaultSecret = vaultSecretFor(tenantId);
  setTenantSecret(ediVaultSecret);
  const emailRef = await storeCredential(`${row.id}:edi:email`, secrets.email ?? '', ediVaultSecret);
  const passwordRef = await storeCredential(`${row.id}:edi:password`, secrets.password ?? '', ediVaultSecret);
  try {
    const ediBaseUrl = resolveEdiBaseUrl(apiUrlOverride, { allowOverride: ediOverrideAllowed() });
    const session = await buildEdiSession({
      clientId,
      sessionTimeout: Number(config.sessionTimeout) || 420,
      emailRef,
      passwordRef,
      ediBaseUrl,
    });
    return await fn(session, ediBaseUrl);
  } finally {
    await Promise.all([emailRef, passwordRef].map((ref) => deleteCredential(ref).catch(() => {})));
  }
}

function ediErrorStatus(message: string): number {
  return /no rapidrms connection|missing its client id/i.test(message) ? 409 : 502;
}

async function handleEdiList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  const override = ediOverrideAllowed() ? getRequestUrl(req).searchParams.get('apiUrl') : null;
  try {
    const files = await withTenantEdiSession(auth.tenantId, override, (session) => listEdiFiles(session));
    json(res, 200, { files });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list EDI invoices';
    console.error('[edi.list]', message);
    json(res, ediErrorStatus(message), { error: message });
  }
}

async function handleEdiUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  if (!canManageMarketplace(auth.role)) return json(res, 403, { error: 'Owner or admin role required' });

  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });
  const ediUpload = body.EDIUpload;
  const items = body.EDIReceiveItem;
  if (!isRecord(ediUpload)) return json(res, 400, { error: 'Missing required field: EDIUpload' });
  if (!Array.isArray(items)) return json(res, 400, { error: 'Missing required field: EDIReceiveItem (array)' });
  const override = ediOverrideAllowed() && typeof body.apiUrl === 'string' ? body.apiUrl : null;

  try {
    const result = await withTenantEdiSession(auth.tenantId, override, (session) =>
      uploadEdi(session, { EDIUpload: ediUpload as any, EDIReceiveItem: items as any }),
    );
    await auditLog({
      tenantId: auth.tenantId, userId: auth.userId, action: 'edi.uploaded', resource: 'rapidrms-edi',
      detail: { status: result.status, receiveId: result.data ?? null, items: items.length }, ip: getClientIp(req),
    });
    json(res, 200, { status: result.status, message: result.message, receiveId: result.data ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to upload EDI invoice';
    console.error('[edi.upload]', message);
    json(res, ediErrorStatus(message), { error: message });
  }
}

async function handleEdiItems(req: IncomingMessage, res: ServerResponse, receiveId: number): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  const override = ediOverrideAllowed() ? getRequestUrl(req).searchParams.get('apiUrl') : null;
  try {
    const items = await withTenantEdiSession(auth.tenantId, override, (session) => getEdiItems(session, receiveId));
    json(res, 200, { items });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load EDI invoice items';
    console.error('[edi.items]', message);
    json(res, ediErrorStatus(message), { error: message });
  }
}

async function handleEdiRevert(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  if (!canManageMarketplace(auth.role)) return json(res, 403, { error: 'Owner or admin role required' });

  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });
  const receiveId = Number(body.receiveId);
  const branchId = Number(body.branchId);
  if (!Number.isFinite(receiveId) || receiveId <= 0) return json(res, 400, { error: 'Valid receiveId is required' });
  if (!Number.isFinite(branchId) || branchId <= 0) return json(res, 400, { error: 'Valid branchId is required' });
  const override = ediOverrideAllowed() && typeof body.apiUrl === 'string' ? body.apiUrl : null;

  try {
    const result = await withTenantEdiSession(auth.tenantId, override, (session) =>
      revertEdi(session, { receiveId, branchId }),
    );
    await auditLog({
      tenantId: auth.tenantId, userId: auth.userId, action: 'edi.reverted', resource: 'rapidrms-edi',
      detail: { status: result.status, receiveId, branchId }, ip: getClientIp(req),
    });
    json(res, 200, { status: result.status, message: result.message });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to revert EDI invoice';
    console.error('[edi.revert]', message);
    json(res, ediErrorStatus(message), { error: message });
  }
}

async function handleHumanConnectors(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return json(res, 401, { error: 'Authentication required' });
  }

  try {
    json(res, 200, { connectors: getHumanConnectors(auth.tenantId) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch connectors';
    console.error('[human-connectors]', message);
    json(res, 500, { error: message });
  }
}

async function handleActivateHumanConnectors(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return json(res, 401, { error: 'Authentication required' });
  }

  try {
    const connectors = activateAllHumanConnectors(auth.tenantId);
    json(res, 200, {
      ok: true,
      activated: connectors.length,
      connectors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to activate connectors';
    console.error('[human-connectors]', message);
    json(res, 500, { error: message });
  }
}

async function buildTenantHumanSnapshot(tenantId: string) {
  const supabase = createSupabaseAdmin();
  const [tenantResult, activityResult] = await Promise.all([
    supabase
      .from('tenants')
      .select('name, created_at')
      .eq('id', tenantId)
      .single(),
    supabase
      .from('audit_log')
      .select('action, detail, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  return buildHumanLayerSnapshot({
    tenantId,
    tenantName: tenantResult.data?.name || 'AROS',
    createdAt: tenantResult.data?.created_at,
    tasks: listTasks(tenantId),
    recentActivity: (activityResult.data || []).map((row: { action: string; detail: Record<string, unknown> | null; created_at: string }) => row),
  });
}

async function handleHumanState(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });

  try {
    json(res, 200, {
      ...await buildTenantHumanSnapshot(auth.tenantId),
      projects: listHumanProjects(auth.tenantId),
      goals: listHumanGoals(auth.tenantId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch human state';
    console.error('[human-state]', message);
    json(res, 500, { error: message });
  }
}

async function handleHumanTasks(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });

  if ((req.method ?? 'GET') === 'GET') {
    return json(res, 200, { tasks: listTasks(auth.tenantId) });
  }

  try {
    const body = await parseJsonBody(req);
    const title = String(body?.title ?? '').trim();
    const description = String(body?.description ?? '').trim();
    if (!title || !description) {
      return json(res, 400, { error: 'title and description are required' });
    }

    const task = createTask({
      title,
      description,
      priority: (body?.priority as TaskPriority | undefined) ?? 'normal',
      agentId: String(body?.agentId ?? 'human-tasks-001'),
      tenantId: auth.tenantId,
      createdBy: auth.userId,
      parentTaskId: typeof body?.parentTaskId === 'string' ? body.parentTaskId : undefined,
      tags: Array.isArray(body?.tags) ? body.tags.map(String) : [],
      context: typeof body?.context === 'object' && body?.context ? body.context as Record<string, unknown> : {},
    });

    json(res, 201, { task });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create task';
    console.error('[human-tasks]', message);
    json(res, 500, { error: message });
  }
}

async function handleHumanProjects(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });

  if ((req.method ?? 'GET') === 'GET') {
    return json(res, 200, { projects: listHumanProjects(auth.tenantId) });
  }

  try {
    const body = await parseJsonBody(req);
    const name = String(body?.name ?? '').trim();
    const description = String(body?.description ?? '').trim();
    if (!name || !description) {
      return json(res, 400, { error: 'name and description are required' });
    }
    const project = createHumanProject(auth.tenantId, {
      name,
      description,
      status: body?.status as 'on_track' | 'watch' | 'stalled' | undefined,
      progress: typeof body?.progress === 'number' ? body.progress : undefined,
      openTasks: typeof body?.openTasks === 'number' ? body.openTasks : undefined,
      completedTasks: typeof body?.completedTasks === 'number' ? body.completedTasks : undefined,
      blockers: Array.isArray(body?.blockers) ? body.blockers.map(String) : undefined,
    });
    json(res, 201, { project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create project';
    console.error('[human-projects]', message);
    json(res, 500, { error: message });
  }
}

async function handleHumanGoals(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });

  if ((req.method ?? 'GET') === 'GET') {
    return json(res, 200, { goals: listHumanGoals(auth.tenantId) });
  }

  try {
    const body = await parseJsonBody(req);
    const name = String(body?.name ?? '').trim();
    const metric = String(body?.metric ?? '').trim();
    const target = String(body?.target ?? '').trim();
    if (!name || !metric || !target) {
      return json(res, 400, { error: 'name, metric, and target are required' });
    }
    const goal = createHumanGoal(auth.tenantId, {
      name,
      metric,
      target,
      status: body?.status as 'on_track' | 'at_risk' | 'done' | undefined,
      progress: typeof body?.progress === 'number' ? body.progress : undefined,
      linkedProjectIds: Array.isArray(body?.linkedProjectIds) ? body.linkedProjectIds.map(String) : undefined,
    });
    json(res, 201, { goal });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create goal';
    console.error('[human-goals]', message);
    json(res, 500, { error: message });
  }
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

// ── Request Handler ─────────────────────────────────────────────

// ── Documents (MIB Drive proxy) ──────────────────────────────────
// AROS consumes MIB's document-storage service. Every request is authenticated
// here, mapped tenant → MIB workspace, then forwarded to MIB with a PER-TENANT
// service token (see connectors/mib-documents.ts). The browser only ever talks
// to these clean /api/documents/* paths — never to MIB directly, and never
// carries the token itself.
//
// The per-tenant token is minted/assigned when the Documents app is activated
// for the tenant (provisionDocumentsAccess, called from both activation paths)
// and persisted — encrypted — on the tenant's marketplace entitlement row.

const DOCUMENTS_APP_KEY = 'documents';

async function resolveMibWorkspaceId(tenantId: string): Promise<string | null> {
  // Prefer a per-tenant mapping stored on the tenant row; fall back to a single
  // workspace env for single-tenant dev. A not-yet-migrated `mib_workspace_id`
  // column simply yields the env fallback rather than erroring.
  try {
    const supabase = createSupabaseAdmin();
    const { data } = await supabase.from('tenants').select('mib_workspace_id').eq('id', tenantId).maybeSingle();
    const mapped = (data as { mib_workspace_id?: string | null } | null)?.mib_workspace_id;
    if (mapped) return mapped;
  } catch {
    // Column/table access failed — fall through to the env fallback.
  }
  return process.env.MIB_DOCS_WORKSPACE_ID || null;
}

/**
 * Mint (or return the existing) per-tenant MIB Documents access token and
 * persist it — encrypted — on the tenant's Documents entitlement. Idempotent:
 * a second call reuses the stored token. Called from the app-activation paths.
 *
 * NOTE: the minted token must also be registered with MIB so its `/drive/*`
 * guard accepts it (token hash → workspace). That MIB-side registration is the
 * documented integration seam and is a no-op here — see report §3.
 */
async function provisionDocumentsAccess(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  tenantId: string,
): Promise<void> {
  const { data: row } = await supabase
    .from('marketplace_app_entitlements')
    .select('service_config')
    .eq('tenant_id', tenantId)
    .eq('app_key', DOCUMENTS_APP_KEY)
    .maybeSingle();

  const cfg: Record<string, unknown> = isRecord(row?.service_config) ? { ...row!.service_config } : {};
  if (
    typeof cfg.mibServiceTokenEnc === 'string' && cfg.mibServiceTokenEnc &&
    typeof cfg.mibWorkspaceId === 'string' && cfg.mibWorkspaceId &&
    cfg.mibTokenRegistered === true
  ) {
    return; // already provisioned and registered with MIB
  }

  const workspaceId = await resolveMibWorkspaceId(tenantId);
  if (!workspaceId) {
    // Can't scope a token without a workspace mapping. In dev, set
    // MIB_DOCS_WORKSPACE_ID; in prod, provision the MIB workspace first.
    console.warn('[documents] activation for tenant %s has no MIB workspace mapping — token not minted', tenantId);
    return;
  }

  ensureConnectorCrypto();
  // Reuse an already-minted token (e.g. a prior activation whose MIB registration
  // failed) so we don't orphan token hashes in MIB; otherwise mint a fresh one.
  let token: string | null = null;
  if (typeof cfg.mibServiceTokenEnc === 'string' && cfg.mibServiceTokenEnc) {
    try { token = decryptValue(cfg.mibServiceTokenEnc); } catch { token = null; }
  }
  if (!token) {
    token = randomBytes(32).toString('base64url');
    cfg.mibServiceTokenEnc = encryptValue(token);
  }
  cfg.mibWorkspaceId = workspaceId;

  // Register the token's hash with MIB so its /drive/* auth bridge accepts this
  // per-tenant token and scopes the actor to `workspaceId`. Idempotent on hash.
  const registered = await registerMibDocsToken(token, workspaceId);
  cfg.mibTokenRegistered = registered;

  await supabase
    .from('marketplace_app_entitlements')
    .update({ service_config: cfg })
    .eq('tenant_id', tenantId)
    .eq('app_key', DOCUMENTS_APP_KEY);

  if (!registered) {
    console.warn(
      '[documents] MIB token registration failed for tenant %s — /drive access will not work until a re-activation registers successfully (check MIB_DOCS_BASE_URL / MIB_DOCS_ADMIN_TOKEN)',
      tenantId,
    );
  }
}

/**
 * Register a minted per-tenant token's SHA-256 hash with MIB's document
 * service-token registry, using the trusted mib007 admin token. Idempotent on
 * the hash. Returns false (and logs) when MIB is unreachable or unconfigured, so
 * activation still persists the token and retries registration on the next call.
 */
async function registerMibDocsToken(token: string, workspaceId: string): Promise<boolean> {
  const base = process.env.MIB_DOCS_BASE_URL;
  const adminToken = process.env.MIB_DOCS_ADMIN_TOKEN || process.env.MIB_DOCS_SERVICE_TOKEN;
  if (!base || !adminToken) {
    console.warn('[documents] MIB_DOCS_BASE_URL / MIB_DOCS_ADMIN_TOKEN not set — cannot register per-tenant token with MIB');
    return false;
  }
  const tokenHash = createHash('sha256').update(token).digest('hex');
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/drive/service-tokens/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ tokenHash, workspaceId, label: 'aros-documents' }),
    });
    if (!res.ok) {
      console.warn('[documents] MIB service-token register returned HTTP %s', res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[documents] MIB service-token register failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Resolve the per-tenant MIB workspace + service token for a document request.
 * Returns null when the tenant has not activated Documents (→ 409).
 */
async function resolveMibDocsAccess(tenantId: string): Promise<{ workspaceId: string; serviceToken: string } | null> {
  // Preferred: the per-tenant token minted at Documents activation.
  try {
    const supabase = createSupabaseAdmin();
    const { data } = await supabase
      .from('marketplace_app_entitlements')
      .select('status, service_config')
      .eq('tenant_id', tenantId)
      .eq('app_key', DOCUMENTS_APP_KEY)
      .maybeSingle();
    if (data && data.status === 'active' && isRecord(data.service_config)) {
      const cfg = data.service_config as Record<string, unknown>;
      const enc = typeof cfg.mibServiceTokenEnc === 'string' ? cfg.mibServiceTokenEnc : '';
      const ws = typeof cfg.mibWorkspaceId === 'string' ? cfg.mibWorkspaceId : '';
      if (enc && ws) {
        ensureConnectorCrypto();
        const token = decryptValue(enc);
        if (token) return { workspaceId: ws, serviceToken: token };
      }
    }
  } catch {
    // fall through to the dev fallback
  }

  // DEV fallback: a single shared token + workspace via env (single-tenant dev).
  const devToken = process.env.MIB_DOCS_SERVICE_TOKEN || '';
  if (devToken) {
    const devWs = await resolveMibWorkspaceId(tenantId);
    if (devWs) return { workspaceId: devWs, serviceToken: devToken };
  }
  return null;
}

/** Translate a clean /api/documents/* sub-path to the MIB drive route. */
function mapDocumentsRoute(method: string, sub: string): string | null {
  const m = method.toUpperCase();

  // Collections — MIB expects the workspace in the path ({ws} filled by caller).
  if (sub === '/tree' && m === 'GET') return '/api/workspaces/{ws}/drive/folders/tree';
  if (sub === '/folders' && (m === 'GET' || m === 'POST')) return '/api/workspaces/{ws}/drive/folders';
  if (sub === '/files' && (m === 'GET' || m === 'POST')) return '/api/workspaces/{ws}/drive/files';
  if (sub === '/shares' && (m === 'GET' || m === 'POST')) return '/api/workspaces/{ws}/drive/shares';
  const revoke = sub.match(/^\/shares\/([^/]+)\/revoke$/);
  if (revoke && m === 'POST') return `/api/workspaces/{ws}/drive/shares/${encodeURIComponent(revoke[1])}/revoke`;

  // Per-item — MIB derives the workspace from the X-Workspace-ID header.
  const folderId = sub.match(/^\/folders\/([^/]+)$/);
  if (folderId && ['GET', 'PATCH', 'DELETE'].includes(m)) return `/api/drive/folders/${encodeURIComponent(folderId[1])}`;
  const fileContent = sub.match(/^\/files\/([^/]+)\/content$/);
  if (fileContent && m === 'GET') return `/api/drive/files/${encodeURIComponent(fileContent[1])}/content`;
  const fileId = sub.match(/^\/files\/([^/]+)$/);
  if (fileId && ['GET', 'PATCH', 'DELETE'].includes(m)) return `/api/drive/files/${encodeURIComponent(fileId[1])}`;

  return null;
}

const DOC_WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

async function handleDocuments(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });

  const access = await resolveMibDocsAccess(auth.tenantId);
  if (!access) return json(res, 409, { error: 'Activate the Documents app for this workspace to use document storage' });

  const url = getRequestUrl(req);
  const sub = url.pathname.replace(/^\/api\/documents/, '') || '/';
  const method = req.method ?? 'GET';

  const template = mapDocumentsRoute(method, sub);
  if (!template) return json(res, 404, { error: 'Unknown documents route' });

  const upstreamPath = template.replace('{ws}', encodeURIComponent(access.workspaceId));
  await proxyToMib(req, res, { method, upstreamPath, search: url.search, workspaceId: access.workspaceId, serviceToken: access.serviceToken });

  if (DOC_WRITE_METHODS.has(method.toUpperCase()) && res.statusCode < 400) {
    void auditLog({ tenantId: auth.tenantId, userId: auth.userId, action: `documents.${method.toLowerCase()}`, resource: sub, ip: getClientIp(req) });
  }
}

// ── Terms & AI-disclosure consent (flag-gated: TERMS_GATE_ENABLED) ──
// Inert by default — enforceGate() is a no-op unless the env flag is truthy.
const terms = createTermsModule({
  createClient: createSupabaseAdmin,
  authenticate: authenticateRequest,
  getClientIp,
  auditLog,
});

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';
  const requestUrl = getRequestUrl(req);
  const pathname = requestUrl.pathname;
  const method = req.method ?? 'GET';

  // Security headers + CORS
  setSecurityHeaders(res);
  setCorsHeaders(req, res);

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/auth/oidc/start' && method === 'GET') { try { const result = await oidcRp.begin({ cookie: req.headers.cookie, returnTo: requestUrl.searchParams.get('returnTo') || undefined, workspaceId: requestUrl.searchParams.get('workspaceId') || undefined }); res.writeHead(302, { Location: result.location, 'Set-Cookie': result.setCookie, 'Cache-Control': 'no-store' }); res.end(); return; } catch { return json(res, 503, { error: 'Identity service unavailable' }); } }
  if (pathname === '/auth/callback' && method === 'GET') { try { const result = await oidcRp.callback({ code: requestUrl.searchParams.get('code') || undefined, state: requestUrl.searchParams.get('state') || undefined, cookie: req.headers.cookie }); res.writeHead(302, { Location: result.location, 'Set-Cookie': result.setCookie, 'Cache-Control': 'no-store' }); res.end(); return; } catch { return json(res, 401, { error: 'OIDC authorization failed' }); } }
  if (pathname === '/auth/session' && method === 'GET') { const session = await oidcRp.authenticate(req.headers.cookie); return session ? json(res, 200, { authenticated: true, subject: session.subject, workspaceId: session.workspaceId, role: session.role }) : json(res, 401, { authenticated: false }); }
  if (pathname === '/auth/logout' && method === 'POST') { const result = await oidcRp.logout(req.headers.cookie); res.writeHead(204, { 'Set-Cookie': result.setCookie, 'Cache-Control': 'no-store' }); res.end(); return; }

  // ── Trace Middleware (SDK detects Express by 3 args: req, res, next) ──
  try { traceMiddleware(req, res, () => {}); } catch { /* non-fatal */ }

  // ── Trace Endpoints ─────────────────────────────────────────
  if (url === '/v1/traces/recent' && method === 'GET') {
    return json(res, 200, getRecentTraces());
  }
  if (url === '/v1/traces/failures' && method === 'GET') {
    return json(res, 200, getRecentFailures());
  }
  if (url === '/v1/traces/stats' && method === 'GET') {
    return json(res, 200, getTraceStats());
  }

  // ── Health ──────────────────────────────────────────────────
  if (url === '/health') {
    return json(res, 200, {
      status: 'ok',
      service: 'aros-platform',
      version: process.env.npm_package_version ?? '0.3.1',
      uptime: process.uptime(),
      startedAt,
    });
  }

  if (url === '/readyz') {
    return json(res, 200, { ready: true });
  }


  // AROS shell enhancement routes: app.aros.live remains the AROS platform dashboard.
  if (pathname.startsWith('/sx-tasks/')) {
    return proxyRequest(req, res, SHRE_TASKS_URL);
  }

  if (pathname === '/api/branding/public') {
    return json(res, 200, {
      brandName: 'AROS',
      theme: { primary: '#2563eb', accent: '#0f766e' },
    });
  }

  if (pathname === '/api/services') {
    return json(res, 200, []);
  }

  if (pathname === '/api/auto-restart/status') {
    return json(res, 200, {
      enabled: false,
      maxUptimeHours: null,
      quietHoursStart: null,
      quietHoursEnd: null,
      uptimes: {},
      history: [],
      nextCheck: null,
    });
  }

  // Device-scoped Edge traffic is served by this control plane. Keep this
  // ahead of the generic /v1 router proxy or enrollment and heartbeats are
  // forwarded to shre-router and return its unrelated 404 response.
  if (pathname.startsWith('/v1/edge/') && await handleEdgeRequest(req, res, pathname)) return;

  if (pathname.startsWith('/api/v1/')) {
    req.url = pathname.slice('/api'.length) + requestUrl.search;
    return proxyRequest(req, res, SHRE_ROUTER_URL);
  }

  if (pathname.startsWith('/v1/') && !pathname.startsWith('/v1/traces/')) {
    return proxyRequest(req, res, SHRE_ROUTER_URL);
  }

  // ── Terms acceptance + AI disclosure (flag-gated) ──────────
  if (pathname === '/api/terms/status' && method === 'GET') {
    return terms.handleStatus(req, res);
  }
  if (pathname === '/api/terms/accept' && method === 'POST') {
    if (!rateLimit(req, 10, 60_000)) {
      return json(res, 429, { error: 'Too many requests. Please wait.' });
    }
    return terms.handleAccept(req, res);
  }
  if (pathname === '/api/disclosures/ack' && method === 'POST') {
    if (!rateLimit(req, 20, 60_000)) {
      return json(res, 429, { error: 'Too many requests. Please wait.' });
    }
    return terms.handleDisclosureAck(req, res);
  }
  // When TERMS_GATE_ENABLED, authenticated API access without a
  // current-version acceptance gets a distinct 428 the SPA turns into the
  // clickwrap screen. With the flag off (default) this is a strict no-op.
  if (await terms.enforceGate(req, res, pathname)) return;

  // ── Billing ─────────────────────────────────────────────────
  if (url === '/api/billing/checkout' && method === 'POST') {
    return handleBillingCheckout(req, res);
  }

  if (url === '/api/billing/portal' && method === 'POST') {
    return handleBillingPortal(req, res);
  }

  if (url === '/api/billing/webhook' && method === 'POST') {
    return handleBillingWebhook(req, res);
  }

  if (url.startsWith('/api/billing/status') && method === 'GET') {
    return handleBillingStatus(req, res);
  }

  // ── Signup ──────────────────────────────────────────────────
  if (url === '/api/signup' && method === 'POST') {
    return handleSignup(req, res);
  }

  // ── Email Verification ────────────────────────────────────
  if (url === '/api/auth/email-otp/send-verification-otp' && method === 'POST') {
    if (!rateLimit(req, 3, 60_000)) {
      return json(res, 429, { error: 'Too many requests. Please wait.' });
    }
    return handleSendOtp(req, res);
  }

  if (url === '/api/auth/email-otp/verify-email' && method === 'POST') {
    if (!rateLimit(req, 10, 60_000)) {
      return json(res, 429, { error: 'Too many attempts. Please wait.' });
    }
    return handleVerifyOtp(req, res);
  }


  // ── Onboarding ────────────────────────────────────────────
  if (url.startsWith('/api/onboarding/status') && method === 'GET') {
    return handleOnboardingStatus(req, res);
  }

  if (url === '/api/onboarding/complete' && method === 'POST') {
    return handleOnboardingComplete(req, res);
  }

  if (url === '/api/onboarding/progress' && method === 'POST') {
    return handleOnboardingProgress(req, res);
  }

  if (url === '/api/onboarding/component' && method === 'POST') {
    return handleOnboardingComponent(req, res);
  }

  // ── Dashboard (authenticated) ──────────────────────────
  if (url === '/api/dashboard' && method === 'GET') {
    return handleDashboard(req, res);
  }

  if (url === '/api/human/state' && method === 'GET') {
    return handleHumanState(req, res);
  }

  if (url === '/api/human/briefing' && method === 'GET') {
    return handleHumanBriefing(req, res);
  }

  if (url === '/api/human/tasks' && method === 'GET') {
    return handleHumanTasks(req, res);
  }

  if (url === '/api/human/tasks' && method === 'POST') {
    return handleHumanTasks(req, res);
  }

  if (url === '/api/human/projects' && method === 'GET') {
    return handleHumanProjects(req, res);
  }

  if (url === '/api/human/projects' && method === 'POST') {
    return handleHumanProjects(req, res);
  }

  if (url === '/api/human/goals' && method === 'GET') {
    return handleHumanGoals(req, res);
  }

  if (url === '/api/human/goals' && method === 'POST') {
    return handleHumanGoals(req, res);
  }

  if (url === '/api/human/connectors' && method === 'GET') {
    return handleHumanConnectors(req, res);
  }

  if (url === '/api/human/connectors/activate' && method === 'POST') {
    return handleActivateHumanConnectors(req, res);
  }

  if (pathname.startsWith('/api/edge/')) {
    const auth = await authenticateRequest(req);
    if (!auth) return json(res, 401, { error: 'Unauthorized' });
    const edgeProvisioning = new EdgeProvisioningService(new SupabaseEdgeProvisioningRepository(createSupabaseAdmin()));
    if (await handleEdgeProvisioningRequest(req, res, pathname, auth, edgeProvisioning)) return;
  }

  // ── Store Connectors (authenticated) ─────────────────────
  if (pathname === '/api/connectors' && method === 'GET') {
    return handleConnectorsList(req, res);
  }

  if (pathname === '/api/connectors' && method === 'POST') {
    return handleConnectorsCreate(req, res);
  }

  if (pathname === '/api/connectors/test' && method === 'POST') {
    return handleConnectorsTest(req, res);
  }

  if (pathname === '/api/connectors' && method === 'DELETE') {
    return handleConnectorsDelete(req, res);
  }

  // ── RapidRMS EDI invoices (reuses the tenant's rapidrms-api connector login) ──
  if (pathname === '/api/rapidrms/edi' && method === 'GET') {
    return handleEdiList(req, res);
  }
  if (pathname === '/api/rapidrms/edi' && method === 'POST') {
    return handleEdiUpload(req, res);
  }
  if (pathname === '/api/rapidrms/edi/revert' && method === 'POST') {
    return handleEdiRevert(req, res);
  }
  const ediItemsMatch = pathname.match(/^\/api\/rapidrms\/edi\/(\d+)$/);
  if (ediItemsMatch && method === 'GET') {
    return handleEdiItems(req, res, Number(ediItemsMatch[1]));
  }

  // Live store data read-back — consumed by the dashboard and by the agent's
  // store-data tool (registered on shre-router; see docs/store-data-flow.md).
  if (pathname === '/api/store/summary' && method === 'GET') {
    return handleStoreSummary(req, res);
  }
  if (pathname === '/api/digest' && method === 'GET') {
    return handleOwnerDigest(req, res);
  }

  if (pathname === '/api/store/sales' && method === 'GET') {
    return handleStoreSales(req, res);
  }
  if (pathname === '/api/workspace/capabilities' && method === 'GET') {
    return handleWorkspaceCapabilities(req, res);
  }
  if (pathname === '/api/settings/models' && (method === 'GET' || method === 'POST')) {
    return handleModelSettings(req, res);
  }
  if (pathname === '/api/store/sync' && (method === 'GET' || method === 'POST')) {
    return handleStoreSync(req, res);
  }

  // ── Documents (MIB Drive proxy, authenticated) ───────────
  if (pathname === '/api/documents' || pathname.startsWith('/api/documents/')) {
    return handleDocuments(req, res);
  }

  if (pathname === '/api/marketplace/entitlements' && method === 'GET') {
    return handleMarketplaceEntitlements(req, res);
  }

  if (pathname === '/api/marketplace/install' && method === 'POST') {
    return handleMarketplaceInstall(req, res);
  }

  const marketplaceDisableMatch = pathname.match(/^\/api\/marketplace\/apps\/([^/]+)\/disable$/);
  if (marketplaceDisableMatch && method === 'POST') {
    return handleMarketplaceDisable(req, res, decodeURIComponent(marketplaceDisableMatch[1]));
  }

  const appEntitlementMatch = pathname.match(/^\/api\/apps\/([^/]+)\/entitlement$/);
  if (appEntitlementMatch && method === 'GET') {
    return handleAppEntitlement(req, res, decodeURIComponent(appEntitlementMatch[1]));
  }

  const resourceMatch = pathname.match(/^\/api\/resources\/(channel|pos|app|agent|skill|model)(?:\/([0-9a-f-]+))?$/);
  if (resourceMatch && ['GET', 'POST', 'PUT'].includes(method)) return handleTenantResources(req, res, resourceMatch[1], resourceMatch[2]);
  const workspaceCompatMatch = pathname.match(/^\/api\/workspaces\/([0-9a-f-]+)$/);
  if (workspaceCompatMatch && ['GET', 'PATCH'].includes(method)) return handleWorkspaceCompat(req, res, workspaceCompatMatch[1]);
  const workspaceMembersMatch = pathname.match(/^\/api\/workspaces\/([0-9a-f-]+)\/members(?:\/([0-9a-f-]+)(?:\/role)?)?$/);
  if (workspaceMembersMatch && ['GET', 'PATCH', 'DELETE'].includes(method)) return handleWorkspaceMembersCompat(req, res, workspaceMembersMatch[1], workspaceMembersMatch[2]);
  const workspaceRolesMatch = pathname.match(/^\/api\/workspaces\/([0-9a-f-]+)\/roles$/);
  if (workspaceRolesMatch && method === 'GET') return handleWorkspaceMembersCompat(req, res, workspaceRolesMatch[1]);
  if (pathname === '/api/apps' && method === 'GET') return handlePlatformApps(req, res);
  if (pathname === '/api/app-launch/consume' && method === 'POST') {
    if (!rateLimit(req, 30, 60_000)) return json(res, 429, { error: 'Too many launch attempts' });
    return handleAppLaunchConsume(req, res);
  }
  const appLaunchMatch = pathname.match(/^\/api\/apps\/([a-z0-9-]+)\/launch$/);
  if (appLaunchMatch && method === 'POST') return handleAppLaunchCreate(req, res, appLaunchMatch[1]);
  const appGrantMatch = pathname.match(/^\/api\/apps\/([a-z0-9-]+)\/grant$/);
  if (appGrantMatch && method === 'POST') return handlePlatformApps(req, res, appGrantMatch[1]);

  // ── Lead capture (public, no auth) ──────────────────────
  if (url === '/api/leads' && method === 'POST') {
    if (!rateLimit(req, 10, 60_000)) {
      return json(res, 429, { error: 'Too many requests. Please wait.' });
    }
    return handleLeadCapture(req, res);
  }

  // ── Login (brute-force protected) ─────────────────────────
  if (url === '/api/login' && method === 'POST') {
    if (!rateLimit(req, 10, 60_000)) {
      return json(res, 429, { error: 'Too many requests. Please wait.' });
    }
    return handleLogin(req, res);
  }

  const fallbackPathname = pathname;
  // SPA fallback: serve the client app for any non-API browser navigation
  // so deep links / refreshes (/login, /auth, /signup, /reset-password,
  // /verify-email, /social, /contact, /admin) bootstrap the SPA instead of
  // 404ing. All /api/* and /v1/* routes are handled above; serveDashboard
  // serves the real static file when one exists, else index.html.
  if (
    (method === 'GET' || method === 'HEAD') &&
    !fallbackPathname.startsWith('/api/') &&
    !fallbackPathname.startsWith('/v1/')
  ) {
    if (await serveDashboard(req, res)) return;
  }

  // ── 404 ─────────────────────────────────────────────────────
  json(res, 404, { error: 'not found' });
}

const server = createServer((req, res) => {
  handler(req, res).catch((err) => {
    console.error('[server] Unhandled error:', err);
    if (!res.headersSent) {
      json(res, 500, { error: 'Internal server error' });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[aros-platform] Health server listening on 0.0.0.0:${PORT}`);
  heartbeat.start();

  // Resume interrupted historical imports after a deploy or process restart.
  setTimeout(() => {
    createSupabaseAdmin().from('store_sync_jobs').select('id').in('status', ['queued', 'running'])
      .then(({ data, error }) => {
        if (error) return console.error('[store-sync] resume query:', error.message);
        for (const job of data || []) void runStoreSync(job.id);
      });
  }, 15_000).unref();

  // Warehouse snapshotter — ON by default (every 6h) so week-over-week trends
  // accrue from day one of a connected store instead of depending on an
  // operator remembering an env flag (journey J4 activation dependency).
  // Opt out with STORE_SNAPSHOT_INTERVAL_MIN=0; override the cadence with any
  // other value. Cheap when idle: one connector query, no connected
  // connectors → no work.
  const snapshotEnv = process.env.STORE_SNAPSHOT_INTERVAL_MIN;
  const snapshotMin = snapshotEnv === undefined || snapshotEnv === '' ? 360 : Number(snapshotEnv);
  if (Number.isFinite(snapshotMin) && snapshotMin > 0) {
    const run = () =>
      captureStoreSnapshots()
        .then((r) => console.log(`[snapshot] captured=${r.captured} failed=${r.failed} skipped=${r.skipped}`))
        .catch((e) => console.error('[snapshot]', e instanceof Error ? e.message : e));
    setInterval(run, snapshotMin * 60_000).unref();
    setTimeout(run, 60_000).unref(); // first run once deps settle
    console.log(`[aros-platform] store snapshotter enabled (every ${snapshotMin}m)`);
  }
});

function shutdown(): void {
  heartbeat.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
