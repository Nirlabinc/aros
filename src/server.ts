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
import { createHash } from 'node:crypto';
import { testConnection as testRapidRmsConnector } from '../connectors/rapidrms-api.js';
import { testConnection as testAzureDbConnector } from '../connectors/azure-db.js';
import { testConnection as testVerifoneConnector } from '../connectors/verifone/connector.js';
import { setTenantSecret, storeCredential, deleteCredential } from '../connectors/vault-ref.js';
import { fetchStoreSummary, type StoreSummary } from '../connectors/data-service.js';
import { encryptValue, decryptValue, setEncryptionKey } from '../security/input-handler.js';
import { getTrustedClientIp, isPublicRouterPath } from './api-security.js';

const PORT = 5457;
const startedAt = new Date().toISOString();
const SHRE_METER_URL = process.env.SHRE_METER_URL || 'http://127.0.0.1:5495';
const SHRE_TASKS_URL = process.env.SHRE_TASKS_URL || 'http://127.0.0.1:5460';
const SHRE_ROUTER_URL = process.env.SHRE_ROUTER_URL || 'http://127.0.0.1:5497';
const WEB_DIST = process.env.AROS_WEB_DIST || join(process.cwd(), 'apps', 'web', 'dist');
const TRUST_PROXY = process.env.AROS_TRUST_PROXY === '1' || process.env.AROS_TRUST_PROXY === 'true';

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
    const parsed: unknown = JSON.parse(raw.toString());
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ── Rate Limiter (per-IP, in-memory) ────────────────────────────

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(req: IncomingMessage, maxRequests: number, windowMs: number): boolean {
  const ip = getClientIp(req);
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
  return getTrustedClientIp(req, TRUST_PROXY);
}

async function authorizeRouterProxy(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (isPublicRouterPath(pathname)) return true;
  if (await authenticateRequest(req)) return true;
  json(res, 401, { error: 'Authentication required' });
  return false;
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
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.aros.live https://*.nirtek.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
}

// ── Billing Routes ──────────────────────────────────────────────

async function handleBillingCheckout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  if (!canManageBilling(auth.role)) return json(res, 403, { error: 'Owner or admin role required' });
  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const { plan } = body as { plan?: unknown };

  const validPlans: PlanId[] = ['starter', 'pro', 'enterprise'];
  if (!validPlans.includes(plan as PlanId)) {
    return json(res, 400, { error: `Invalid plan. Must be one of: ${validPlans.join(', ')}` });
  }

  try {
    const url = await createCheckoutSession({
      tenantId: auth.tenantId,
      plan: plan as PlanId,
      email: auth.email,
    });

    await auditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
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
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  if (!canManageBilling(auth.role)) return json(res, 403, { error: 'Owner or admin role required' });

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.from('tenants').select('stripe_customer_id').eq('id', auth.tenantId).single();
    if (error || !data?.stripe_customer_id) return json(res, 404, { error: 'Billing customer not found' });
    const url = await createPortalSession(data.stripe_customer_id);
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
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  const tenantId = auth.tenantId;

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

async function handleOnboardingStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  const tenantId = auth.tenantId;

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

    json(res, 200, {
      tenantId: tenant.id,
      completed: tenant.onboarding_completed === true,
      step: progress?.step ?? 1,
      stepData: progress?.step_data ?? {},
      completedAt: progress?.completed_at ?? null,
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
  email: string;
  tenantId: string;
  role: string;
};

function getRequestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
}

function getRequestedTenantId(req: IncomingMessage): string | null {
  const headerTenantId = req.headers['x-aros-tenant-id'] ?? req.headers['x-tenant-id'];
  if (Array.isArray(headerTenantId)) return headerTenantId[0] || null;
  const requested = typeof headerTenantId === 'string' && headerTenantId.trim()
    ? headerTenantId.trim()
    : getRequestUrl(req).searchParams.get('tenantId');
  return requested && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requested)
    ? requested
    : null;
}

async function authenticateRequest(req: IncomingMessage): Promise<AuthContext | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  try {
    const supabase = createSupabaseAdmin();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;

    const requestedTenantId = getRequestedTenantId(req);
    let membershipQuery = supabase
      .from('tenant_members')
      .select('tenant_id, role, status')
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (requestedTenantId) {
      membershipQuery = membershipQuery.eq('tenant_id', requestedTenantId);
    }

    const { data: memberships } = await membershipQuery
      .order('is_default', { ascending: false })
      .order('joined_at', { ascending: true })
      .limit(1);

    const membership = memberships?.[0];

    if (!membership) return null;
    return {
      userId: user.id,
      email: user.email || '',
      tenantId: membership.tenant_id,
      role: membership.role || 'member',
    };
  } catch {
    return null;
  }
}

function canManageMarketplace(role: string): boolean {
  return ['owner', 'admin'].includes(role);
}

function canManageBilling(role: string): boolean {
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
    }
  } catch (err) {
    console.error('[store-summary]', err instanceof Error ? err.message : err);
    summary = null;
  }

  storeSummaryCache.set(tenantId, { at: Date.now(), summary });
  return summary;
}

async function handleStoreSummary(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  const summary = await getTenantStoreSummary(auth.tenantId);
  if (!summary) {
    return json(res, 200, { connected: false, summary: null });
  }
  json(res, 200, { connected: true, summary });
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
    setTenantSecret(vaultSecretFor(auth.tenantId));
    const passwordRef = await storeCredential(`${row.id}:password`, secrets.password ?? '');
    refs.push(passwordRef);

    let result;
    if (row.type === 'rapidrms-api') {
      const emailRef = await storeCredential(`${row.id}:email`, secrets.email ?? '');
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

    // A newly-connected (or newly-broken) connector should reflect on the
    // dashboard immediately, not after the summary TTL expires.
    storeSummaryCache.delete(auth.tenantId);

    json(res, 200, { ok: true, result });
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

  // ── Trace Middleware (SDK detects Express by 3 args: req, res, next) ──
  try { traceMiddleware(req, res, () => {}); } catch { /* non-fatal */ }

  // ── Trace Endpoints ─────────────────────────────────────────
  if (url === '/v1/traces/recent' && method === 'GET') {
    if (!(await authenticateRequest(req))) return json(res, 401, { error: 'Authentication required' });
    return json(res, 200, getRecentTraces());
  }
  if (url === '/v1/traces/failures' && method === 'GET') {
    if (!(await authenticateRequest(req))) return json(res, 401, { error: 'Authentication required' });
    return json(res, 200, getRecentFailures());
  }
  if (url === '/v1/traces/stats' && method === 'GET') {
    if (!(await authenticateRequest(req))) return json(res, 401, { error: 'Authentication required' });
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

  if (pathname.startsWith('/api/v1/')) {
    if (!(await authorizeRouterProxy(req, res, pathname))) return;
    req.url = pathname.slice('/api'.length) + requestUrl.search;
    return proxyRequest(req, res, SHRE_ROUTER_URL);
  }

  if (pathname.startsWith('/v1/') && !pathname.startsWith('/v1/traces/')) {
    if (!(await authorizeRouterProxy(req, res, pathname))) return;
    return proxyRequest(req, res, SHRE_ROUTER_URL);
  }

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

  // Live store data read-back — consumed by the dashboard and by the agent's
  // store-data tool (registered on shre-router; see docs/store-data-flow.md).
  if (pathname === '/api/store/summary' && method === 'GET') {
    return handleStoreSummary(req, res);
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
});

function shutdown(): void {
  heartbeat.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
