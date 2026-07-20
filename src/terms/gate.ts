/**
 * Terms-acceptance + AI-disclosure consent layer (flag-gated).
 *
 * Everything here is inert unless TERMS_GATE_ENABLED is truthy — with the
 * flag off (the default) no request is blocked, no route behavior changes,
 * and no extra DB round-trips happen on the hot path.
 *
 * With the flag on:
 *   - GET  /api/terms/status     → gate flag, versions, caller's acceptance state
 *   - POST /api/terms/accept     → append-only acceptance row; the server (never
 *                                  the client) stamps ip / user_agent / accepted_at
 *   - POST /api/disclosures/ack  → per-feature disclosure acknowledgement
 *   - enforceGate()              → authenticated /api access without a
 *                                  current-version acceptance gets a distinct
 *                                  428 `terms_acceptance_required` response
 *                                  that the SPA turns into the clickwrap screen.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  TERMS_VERSION,
  PRIVACY_VERSION,
  AI_CHAT_DISCLOSURE_KEY,
  TERMS_REQUIRED_STATUS,
  TERMS_REQUIRED_CODE,
  isTermsGateEnabled,
} from './constants.js';

// Minimal structural view of the Supabase client so tests can inject a fake.
type QueryResult = Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
interface TableQuery {
  select(columns: string): TableQuery;
  eq(column: string, value: unknown): TableQuery;
  limit(count: number): QueryResult;
}
export interface TermsDbClient {
  from(table: string): TableQuery & {
    insert(row: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
    upsert(
      row: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ): Promise<{ error: { message: string } | null }>;
  };
}

export interface TermsAuthContext {
  userId: string;
  tenantId: string;
  role: string;
}

export interface TermsModuleDeps {
  /**
   * Supabase admin-client factory (or a test fake). Typed loosely because the
   * real SupabaseClient's fluent builder generics don't structurally match
   * the minimal TermsDbClient view; the module only uses the subset above.
   */
  createClient: () => unknown;
  authenticate: (req: IncomingMessage) => Promise<TermsAuthContext | null>;
  getClientIp: (req: IncomingMessage) => string;
  auditLog: (opts: {
    tenantId?: string;
    userId?: string;
    action: string;
    resource?: string;
    detail?: Record<string, unknown>;
    ip?: string;
  }) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  /** Positive-acceptance cache TTL; acceptance is immutable so 60s is safe. */
  cacheTtlMs?: number;
}

/**
 * API paths that must stay reachable without a current-version acceptance:
 * unauthenticated/public surfaces, pre-acceptance auth steps (login, signup,
 * email verification), server-to-server webhooks, device/edge traffic, and
 * the consent endpoints themselves.
 */
const EXEMPT_PREFIXES = [
  '/api/terms/',
  '/api/disclosures/',
  '/api/auth/', // email-OTP verification happens before the user can accept
  '/api/edge/', // device provisioning — machines don't click through terms
];
const EXEMPT_EXACT = new Set([
  '/api/login',
  '/api/signup',
  '/api/leads',
  '/api/services',
  '/api/branding/public',
  '/api/auto-restart/status',
  '/api/billing/webhook', // Stripe server-to-server
  '/api/app-launch/consume', // trusted app backends redeem launch codes
]);

export function isTermsExemptPath(pathname: string): boolean {
  if (EXEMPT_EXACT.has(pathname)) return true;
  return EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Version-keyed re-gating: any mismatch (including null) requires acceptance. */
export function needsAcceptance(
  latestAcceptedVersion: string | null,
  currentVersion: string = TERMS_VERSION,
): boolean {
  return latestAcceptedVersion !== currentVersion;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > 64 * 1024) return null; // consent payloads are tiny
      chunks.push(buf);
    }
    if (chunks.length === 0) return null;
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function createTermsModule(deps: TermsModuleDeps) {
  const env = deps.env ?? process.env;
  const cacheTtlMs = deps.cacheTtlMs ?? 60_000;
  // Cache POSITIVE results only: acceptance rows are append-only, so a "yes"
  // can never become stale within the TTL, while a "no" flips to "yes" the
  // instant the user accepts and must not be cached.
  const acceptedCache = new Map<string, number>();

  function json(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  async function hasCurrentAcceptance(userId: string): Promise<boolean> {
    const cachedAt = acceptedCache.get(userId);
    if (cachedAt !== undefined && Date.now() - cachedAt < cacheTtlMs) return true;
    const client = deps.createClient() as TermsDbClient;
    const { data, error } = await client
      .from('terms_acceptances')
      .select('id')
      .eq('user_id', userId)
      .eq('terms_version', TERMS_VERSION)
      .limit(1);
    if (error) throw new Error(error.message);
    const accepted = !!data && data.length > 0;
    if (accepted) acceptedCache.set(userId, Date.now());
    return accepted;
  }

  async function hasAnyAcceptance(userId: string): Promise<boolean> {
    const client = deps.createClient() as TermsDbClient;
    const { data } = await client
      .from('terms_acceptances')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    return !!data && data.length > 0;
  }

  async function hasDisclosureAck(userId: string, disclosureKey: string): Promise<boolean> {
    const client = deps.createClient() as TermsDbClient;
    const { data } = await client
      .from('user_disclosures')
      .select('id')
      .eq('user_id', userId)
      .eq('disclosure_key', disclosureKey)
      .eq('version', TERMS_VERSION)
      .limit(1);
    return !!data && data.length > 0;
  }

  /**
   * Middleware-style check for authenticated /api access. Returns true when
   * the response has been written (request blocked), false to continue.
   * Strictly a no-op unless TERMS_GATE_ENABLED is truthy.
   */
  async function enforceGate(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    if (!isTermsGateEnabled(env)) return false;
    if (!pathname.startsWith('/api/')) return false;
    if (isTermsExemptPath(pathname)) return false;
    // Only gate bearer-authenticated users; requests without credentials get
    // each route's own 401 handling, service tokens are not humans.
    if (!req.headers.authorization?.startsWith('Bearer ')) return false;
    let auth: TermsAuthContext | null = null;
    try {
      auth = await deps.authenticate(req);
    } catch {
      return false;
    }
    if (!auth) return false;
    try {
      if (await hasCurrentAcceptance(auth.userId)) return false;
    } catch {
      // Fail open: a consent-storage outage must not take down the platform.
      return false;
    }
    json(res, TERMS_REQUIRED_STATUS, {
      error: 'You must accept the current Terms of Service to continue.',
      code: TERMS_REQUIRED_CODE,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
    });
    return true;
  }

  /** GET /api/terms/status — public shape without auth, caller state with it. */
  async function handleStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const base = {
      gateEnabled: isTermsGateEnabled(env),
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      aiChatDisclosureKey: AI_CHAT_DISCLOSURE_KEY,
    };
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      return json(res, 200, { ...base, accepted: null, previouslyAccepted: null, aiDisclosureAcknowledged: null });
    }
    const auth = await deps.authenticate(req);
    if (!auth) {
      return json(res, 200, { ...base, accepted: null, previouslyAccepted: null, aiDisclosureAcknowledged: null });
    }
    try {
      const [accepted, previouslyAccepted, aiAck] = await Promise.all([
        hasCurrentAcceptance(auth.userId),
        hasAnyAcceptance(auth.userId),
        hasDisclosureAck(auth.userId, AI_CHAT_DISCLOSURE_KEY),
      ]);
      return json(res, 200, {
        ...base,
        accepted,
        previouslyAccepted,
        aiDisclosureAcknowledged: aiAck,
      });
    } catch {
      // Fail open (accepted: null) — the SPA treats unknown as "don't block".
      return json(res, 200, { ...base, accepted: null, previouslyAccepted: null, aiDisclosureAcknowledged: null });
    }
  }

  /**
   * POST /api/terms/accept — records affirmative clickwrap assent. The server
   * stamps ip / user_agent / accepted_at; any client-supplied values for
   * those fields are ignored.
   */
  async function handleAccept(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = await deps.authenticate(req);
    if (!auth) return json(res, 401, { error: 'Authentication required' });
    const body = await readJsonBody(req);
    if (body?.accepted !== true) {
      return json(res, 400, { error: 'Affirmative acceptance required: send { "accepted": true }' });
    }
    const acceptedAt = new Date().toISOString();
    const ip = deps.getClientIp(req);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 512) || null;
    const client = deps.createClient() as TermsDbClient;
    const { error } = await client.from('terms_acceptances').insert({
      user_id: auth.userId,
      tenant_id: auth.tenantId || null,
      terms_version: TERMS_VERSION,
      privacy_version: PRIVACY_VERSION,
      accepted_at: acceptedAt,
      ip,
      user_agent: userAgent,
    });
    if (error) return json(res, 500, { error: 'Could not record acceptance. Please try again.' });
    acceptedCache.set(auth.userId, Date.now());
    await deps.auditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'terms.accepted',
      resource: `terms:${TERMS_VERSION}`,
      detail: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION },
      ip,
    });
    return json(res, 200, {
      accepted: true,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      acceptedAt,
    });
  }

  const KNOWN_DISCLOSURE_KEYS = new Set<string>([AI_CHAT_DISCLOSURE_KEY]);

  /** POST /api/disclosures/ack — idempotent per user + key + version. */
  async function handleDisclosureAck(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = await deps.authenticate(req);
    if (!auth) return json(res, 401, { error: 'Authentication required' });
    const body = await readJsonBody(req);
    const disclosureKey = typeof body?.disclosureKey === 'string' ? body.disclosureKey : '';
    if (!KNOWN_DISCLOSURE_KEYS.has(disclosureKey)) {
      return json(res, 400, { error: 'Unknown disclosureKey' });
    }
    const client = deps.createClient() as TermsDbClient;
    const { error } = await client.from('user_disclosures').upsert(
      {
        user_id: auth.userId,
        tenant_id: auth.tenantId || null,
        disclosure_key: disclosureKey,
        version: TERMS_VERSION,
        acknowledged_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,disclosure_key,version', ignoreDuplicates: true },
    );
    if (error) return json(res, 500, { error: 'Could not record acknowledgement. Please try again.' });
    await deps.auditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'disclosure.acknowledged',
      resource: `disclosure:${disclosureKey}`,
      detail: { disclosureKey, version: TERMS_VERSION },
      ip: deps.getClientIp(req),
    });
    return json(res, 200, { acknowledged: true, disclosureKey, version: TERMS_VERSION });
  }

  return { enforceGate, handleStatus, handleAccept, handleDisclosureAck };
}
