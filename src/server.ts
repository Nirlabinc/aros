/**
 * AROS Platform — Health Server + Billing API + Signup + Onboarding
 *
 * Lightweight HTTP server providing /health, /readyz, billing, signup,
 * onboarding, and email verification endpoints.
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
import { createSupabaseAdmin } from './supabase.js';
import { createEventBus } from 'shre-sdk/events';
import { createHeartbeatMonitor } from 'shre-sdk/heartbeat';
import {
  createTraceMiddleware,
  getRecentTraces,
  getRecentFailures,
  getTraceStats,
} from 'shre-sdk/trace';

const PORT = 5457;
const startedAt = new Date().toISOString();
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

    json(res, 200, {
      tenantId: data.id,
      plan: subscription?.plan || data.plan,
      billingStatus: subscription?.status || data.billing_status,
      stripeCustomerId: data.stripe_customer_id,
      subscription,
      licenseTier: data.license_tier,
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

  await supabase.from('tenant_members').insert({
    tenant_id: tenantId,
    user_id: input.userId,
    role: 'owner',
  });

  await supabase.from('onboarding_progress').upsert({
    tenant_id: tenantId,
    step: 1,
    step_data: {},
  }, { onConflict: 'tenant_id' });

  let licenseKey: string | null = null;
  try {
    licenseKey = await provisionLicense(tenantId, 'free');
  } catch (err) {
    console.error(
      '[signup] License provisioning failed:',
      err instanceof Error ? err.message : err,
    );
  }

  return { tenantId, licenseKey, existing: false };
}

async function handleSignup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!rateLimit(req, 5, 60_000)) {
    return json(res, 429, { error: 'Too many signup attempts. Please wait a minute.' });
  }

  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });

  const { name, email, password, company, posSystem, storeCount } = body as {
    name?: string;
    email?: string;
    password?: string;
    company?: string;
    posSystem?: string;
    storeCount?: number;
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

// ── Request Handler ─────────────────────────────────────────────

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';
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


  const pathname = requestUrl(req).pathname;

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


  if (url === "/api/dashboard" && method === "GET") {
    return json(res, 200, {
      todaySales: { revenue: 4827.5, changePercent: 12.3 },
      activeAlerts: { count: 3, critical: 1 },
      aiAgents: { active: 4, total: 6, statuses: { running: 4, idle: 2 } },
      lowStock: {
        count: 7,
        items: [
          { name: "Marlboro Gold Pack", current: 4, threshold: 12 },
          { name: "Coca-Cola 20oz", current: 9, threshold: 24 },
          { name: "Lottery Roll #42", current: 1, threshold: 3 },
        ],
      },
      humanLayer: {
        briefing: {
          date: new Date().toISOString().slice(0, 10),
          generatedAt: new Date().toISOString(),
          executiveSummary: "AROS is ready. Your dashboard, agents, alerts, and task layer are online.",
          focus: "Connect your first store data source",
          topPriorities: [],
          decisionsNeeded: [],
          waitingOn: [],
          followUps: [],
          alerts: [],
        },
        tasks: { total: 0, open: 0, overdue: 0, urgent: 0, items: [] },
        projects: [],
        goals: [],
        connectors: [],
        importantInfo: { unreadMessages: 0, missedCalls: 0, pendingDecisions: 0, pendingFollowUps: 0 },
      },
      recentActivity: [
        { id: "inventory-1", agent: "Inventory Agent", action: "Generated reorder list for 7 low-stock items", timestamp: "2 min ago", type: "warning" },
        { id: "sales-1", agent: "Sales Agent", action: "Morning sales report processed", timestamp: "18 min ago", type: "success" },
        { id: "pricing-1", agent: "Pricing Agent", action: "Promotion checks are ready", timestamp: "45 min ago", type: "info" },
      ],
    });
  }

  // ── Onboarding ────────────────────────────────────────────
  if (url.startsWith('/api/onboarding/status') && method === 'GET') {
    return handleOnboardingStatus(req, res);
  }

  if (url === '/api/onboarding/complete' && method === 'POST') {
    return handleOnboardingComplete(req, res);
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

  const fallbackPathname = requestUrl(req).pathname;
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
