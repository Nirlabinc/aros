/**
 * AROS Platform — Health Server + Billing API + Signup + Onboarding
 *
 * Lightweight HTTP server providing /health, /readyz, billing, signup,
 * onboarding, and email verification endpoints.
 * Uses Node built-in http module to avoid adding dependencies.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
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

const PORT = 5457;
const startedAt = new Date().toISOString();
const SHRE_METER_URL = process.env.SHRE_METER_URL || 'http://127.0.0.1:5495';

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

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const periodStart = monthStart.toISOString();
    const periodEnd = new Date().toISOString();

    let currentPeriodUsage: {
      totalCostUsd?: number;
      totalSavingsUsd?: number;
      totalRequests?: number;
      totalTokens?: number;
      avgCostPerRequest?: number;
      periodFrom?: string;
      periodTo?: string;
    } | null = null;

    try {
      const meterUrl = new URL('/v1/costs/summary', SHRE_METER_URL);
      meterUrl.searchParams.set('from', periodStart);
      meterUrl.searchParams.set('to', periodEnd);
      meterUrl.searchParams.set('tenantId', tenantId);

      const meterRes = await fetch(meterUrl);
      if (meterRes.ok) {
        currentPeriodUsage = (await meterRes.json()) as typeof currentPeriodUsage;
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

    // Update tenant
    await supabase
      .from('tenants')
      .update({
        name: companyName || undefined,
        store_count: typeof storeCount === 'number' ? storeCount : undefined,
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tenantId);

    // Update onboarding progress
    await supabase
      .from('onboarding_progress')
      .update({
        step: 4,
        step_data: { companyName, storeName, storeCount, industry, phone, address },
        completed_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId);

    await auditLog({
      tenantId,
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
        await auditLog({ action: 'signup.duplicate', detail: { email: safeEmail }, ip: clientIp });
        return json(res, 409, { error: 'An account with this email already exists' });
      }
      return json(res, 400, { error: msg });
    }

    const userId = authData.user.id;

    // 2. Create tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        name: safeCompany,
        owner_id: userId,
        plan: 'free',
        billing_status: 'none',
        pos_system: safePosSystem,
        store_count: typeof storeCount === 'number' ? storeCount : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (tenantError || !tenant) {
      console.error('[signup] Tenant creation failed:', tenantError?.message);
      return json(res, 500, { error: 'Failed to create tenant' });
    }

    const tenantId = tenant.id;

    // 3. Create tenant_members row (owner role)
    await supabase.from('tenant_members').insert({
      tenant_id: tenantId,
      user_id: userId,
      role: 'owner',
    });

    // 4. Create onboarding_progress row
    await supabase.from('onboarding_progress').insert({
      tenant_id: tenantId,
      step: 1,
      step_data: {},
    });

    // 5. Provision free license
    let licenseKey: string | null = null;
    try {
      licenseKey = await provisionLicense(tenantId, 'free');
    } catch (err) {
      console.error(
        '[signup] License provisioning failed:',
        err instanceof Error ? err.message : err,
      );
    }

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
        licenseKey,
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

async function authenticateRequest(req: IncomingMessage): Promise<{ userId: string; tenantId: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  try {
    const supabase = createSupabaseAdmin();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;

    // Look up tenant membership
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (!membership) return null;
    return { userId: user.id, tenantId: membership.tenant_id };
  } catch {
    return null;
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

    // Build response — real data where available, zeros for unconnected sources
    const dashboard = {
      todaySales: {
        revenue: 0,
        changePercent: 0,
        _note: tenant?.pos_system ? undefined : 'Connect your POS system to see live sales data',
      },
      activeAlerts: {
        count: 0,
        critical: 0,
      },
      aiAgents: {
        active: activeAgents || (tenant?.plan === 'free' ? 1 : 0),
        total: totalAgents || (tenant?.plan === 'free' ? 2 : tenant?.plan === 'starter' ? 5 : 10),
        statuses: Object.keys(statuses).length > 0 ? statuses : { available: totalAgents || 2 },
      },
      lowStock: {
        count: 0,
        items: [] as Array<{ name: string; current: number; threshold: number }>,
        _note: tenant?.pos_system ? undefined : 'Connect your POS system to see inventory alerts',
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
