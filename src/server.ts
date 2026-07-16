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
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { DEFAULT_MODEL } from './model-defaults.js';
import { testConnection as testRapidRmsConnector } from '../connectors/rapidrms-api.js';
import { testConnection as testAzureDbConnector } from '../connectors/azure-db.js';
import { testConnection as testVerifoneConnector } from '../connectors/verifone/connector.js';
import { setTenantSecret, storeCredential, deleteCredential } from '../connectors/vault-ref.js';
import { fetchStoreSalesRange, fetchStoreSummary, type StoreSummary } from '../connectors/data-service.js';
import { replicateSnapshotToCortex } from '../connectors/cortex-bridge.js';
import { encryptValue, decryptValue, setEncryptionKey } from '../security/input-handler.js';
import { handleEdgeRequest } from './edge/http.js';
import { handleEdgeProvisioningRequest } from './edge/provisioning-http.js';
import { EdgeProvisioningService } from './edge/provisioning.js';
import { SupabaseEdgeProvisioningRepository } from './edge/supabase-provisioning-repository.js';

const PORT = Number(process.env.PORT || 5457);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
const startedAt = new Date().toISOString();
const SHRE_METER_URL = process.env.SHRE_METER_URL || 'http://127.0.0.1:5495';
const SHRE_TASKS_URL = process.env.SHRE_TASKS_URL || 'http://127.0.0.1:5460';
const SHRE_ROUTER_URL = process.env.SHRE_ROUTER_URL || 'http://127.0.0.1:5497';
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

async function handleOnboardingStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const tenantId = url.searchParams.get('tenantId');

  if (!tenantId) {
    return json(res, 400, { error: 'Missing query parameter: tenantId' });
  }

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
};

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
  appLaunchGrants.set(hashAppLaunchCode(code), { appKey, tenantId: auth.tenantId, userId: auth.userId, role: auth.role, storeIds, expiresAt: Date.now() + APP_LAUNCH_TTL_MS });
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
  json(res, 200, { appKey, tenantId: grant.tenantId, userId: grant.userId, email: user.email || '', name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User', role: grant.role, stores: connectors || [] });
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
    return error ? json(res, 500, { error: error.message }) : json(res, 200, { apps: apps || [], grants: grants || [] });
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
  if (bundle?.skills.length) {
    const skillRows = bundle.skills.map(skill => ({
      tenant_id: auth.tenantId, kind: 'skill', provider: appId, name: skill.name,
      status: activationState === 'ready' ? 'active' : 'configuring', capabilities: skill.capabilities,
      config: { appKey: appId, managedByApp: true }, store_ids: storeIds,
      health: { state: activationState, checkedAt: new Date().toISOString() }, created_by: auth.userId,
    }));
    const { error: skillError } = await supabase.from('tenant_resources').upsert(skillRows, { onConflict: 'tenant_id,kind,name' });
    if (skillError) return json(res, 500, { error: skillError.message });
  }
  await auditLog({ tenantId: auth.tenantId, userId: auth.userId, action: 'app.granted', resource: `app:${appId}`, detail: { scopes: requested, storeIds, activationState, capabilities }, ip: getClientIp(req) });
  json(res, 200, { grant: data });
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
  json(res, 200, summary ? { connected: true, summary } : { connected: false, summary: null });
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

const APP_CAPABILITY_BUNDLES: Record<string, { tools: string[]; skills: Array<{ name: string; capabilities: string[] }> }> = {
  storepulse: {
    tools: ['mib_sales_today', 'mib_sales_summary', 'mib_sales_totals', 'mib_top_items', 'mib_item_search', 'mib_low_inventory'],
    skills: [
      { name: 'Daily Sales Summary', capabilities: ['pos.sales.read'] },
      { name: 'Inventory Health', capabilities: ['pos.inventory.read'] },
      { name: 'Store Performance', capabilities: ['stores.read', 'pos.sales.read'] },
    ],
  },
  mib: { tools: ['mib_workspace_get', 'mib_agent_list', 'mib_task_list'], skills: [{ name: 'Workspace Operations', capabilities: ['workspace.admin'] }] },
  centrix: { tools: ['centrix_search', 'centrix_ticket_list'], skills: [{ name: 'Customer and Ticket Operations', capabilities: ['crm.read', 'tickets.read'] }] },
};

async function handleWorkspaceCapabilities(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const serviceToken = readServiceToken();
  const presented = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const source = Array.isArray(req.headers['x-service-source']) ? req.headers['x-service-source'][0] : req.headers['x-service-source'];
  const tenantId = getRequestUrl(req).searchParams.get('tenantId') || '';
  if (!serviceToken || source !== 'shre-router' || !tokensMatch(presented, serviceToken) || !UUID_RE.test(tenantId)) return json(res, 401, { error: 'Authentication required' });
  const supabase = createSupabaseAdmin();
  const [{ data: grants, error: grantError }, { data: resources, error: resourceError }] = await Promise.all([
    supabase.from('marketplace_app_entitlements').select('app_key,status,service_config').eq('tenant_id', tenantId).eq('status', 'active'),
    supabase.from('tenant_resources').select('kind,provider,name,status,capabilities,config,store_ids').eq('tenant_id', tenantId).eq('status', 'active'),
  ]);
  if (grantError || resourceError) return json(res, 500, { error: grantError?.message || resourceError?.message });
  const appKeys = (grants || []).map(grant => String(grant.app_key));
  const tools = [...new Set(appKeys.flatMap(appKey => APP_CAPABILITY_BUNDLES[appKey]?.tools || []))];
  await auditLog({ tenantId, action: 'workspace.capabilities.service_read', resource: tenantId, detail: { source, apps: appKeys.length, tools: tools.length }, ip: getClientIp(req) });
  json(res, 200, { tenantId, apps: grants || [], resources: resources || [], tools, generatedAt: new Date().toISOString() });
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
    return error ? json(res, 500, { error: error.message }) : json(res, 200, { jobs: data || [] });
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

  // Live store data read-back — consumed by the dashboard and by the agent's
  // store-data tool (registered on shre-router; see docs/store-data-flow.md).
  if (pathname === '/api/store/summary' && method === 'GET') {
    return handleStoreSummary(req, res);
  }
  if (pathname === '/api/store/sales' && method === 'GET') {
    return handleStoreSales(req, res);
  }
  if (pathname === '/api/workspace/capabilities' && method === 'GET') {
    return handleWorkspaceCapabilities(req, res);
  }
  if (pathname === '/api/store/sync' && (method === 'GET' || method === 'POST')) {
    return handleStoreSync(req, res);
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

  // Warehouse snapshotter — env-gated (STORE_SNAPSHOT_INTERVAL_MIN>0 to enable).
  // Off by default: no env, no background work.
  const snapshotMin = Number(process.env.STORE_SNAPSHOT_INTERVAL_MIN || 0);
  if (snapshotMin > 0) {
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
