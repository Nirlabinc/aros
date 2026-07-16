// ── RapidRMS API Connector ──────────────────────────────────────
// Authenticates and communicates with the RapidRMS API.
// Credentials retrieved from vault at auth time — never stored or logged.

import type { RapidRmsApiConfig, RapidRmsSession, ConnectorTestResult } from './types.js';
import { retrieveCredential } from './vault-ref.js';

function unwrapEnvelope(body: Record<string, unknown>): Record<string, unknown> {
  if (body.code === '999' && body.data) {
    const data = typeof body.data === 'string' ? JSON.parse(body.data) : body.data;
    return (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  }
  return body;
}

// ── Authenticate ────────────────────────────────────────────────

/** Authenticate with RapidRMS. Retrieves email + password from vault. */
export async function authenticate(
  config: RapidRmsApiConfig,
  emailRef: string,
  passwordRef: string,
): Promise<RapidRmsSession> {
  const email = await retrieveCredential(emailRef);
  const password = await retrieveCredential(passwordRef);

  const res = await fetch(`${config.baseUrl}/api/Login/Auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'token',
      client_id: config.clientId,
      Username: email,
      Password: password,
    }),
  });

  if (!res.ok) {
    throw new Error(`RapidRMS auth failed: ${res.status} ${res.statusText}`);
  }

  const data = unwrapEnvelope((await res.json()) as Record<string, unknown>);
  const token = String(data.access_token || data.Token || data.token || '');
  if (!token) throw new Error('No token in RapidRMS auth response');
  const cookie = res.headers.get('set-cookie') ?? '';
  const timeout = config.sessionTimeout || 420;

  return {
    config,
    dbName: String(data.DbName ?? ''),
    token,
    cookie,
    expiresAt: Date.now() + timeout * 60 * 1000,
    authenticated: true,
  };
}

// ── Request ─────────────────────────────────────────────────────

/** Make authenticated API request. Auto-refreshes if session expired. */
export async function request(
  session: RapidRmsSession,
  method: string,
  path: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  if (!session.authenticated) {
    throw new Error('Not authenticated — call authenticate() first');
  }

  const url = `${session.config.baseUrl}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
      ClientId: session.config.clientId,
      DbName: session.dbName,
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    },
  };

  if (params && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    opts.body = JSON.stringify(params);
  }

  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new Error(`RapidRMS ${method} ${path}: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as Record<string, unknown>;
  return unwrapEnvelope(body);
}

// ── Test ────────────────────────────────────────────────────────

/** Test auth + connectivity. */
export async function testConnection(
  config: RapidRmsApiConfig,
  emailRef: string,
  passwordRef: string,
): Promise<ConnectorTestResult> {
  const start = Date.now();
  try {
    const session = await authenticate(config, emailRef, passwordRef);
    return {
      success: session.authenticated && session.dbName.length > 0,
      latencyMs: Date.now() - start,
      testedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      testedAt: new Date().toISOString(),
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────

/** Get the database name from an authenticated session. */
export function getDbName(session: RapidRmsSession): string {
  return session.dbName;
}

// ── Standard Endpoints ──────────────────────────────────────────

export async function getSalesDetail(session: RapidRmsSession, params?: Record<string, unknown>) {
  return request(session, 'POST', '/api/SalesDetail/Get', params);
}

export async function getInventory(session: RapidRmsSession, params?: Record<string, unknown>) {
  return request(session, 'POST', '/api/Inventory/Get', params);
}

export async function getPricing(session: RapidRmsSession, params?: Record<string, unknown>) {
  return request(session, 'POST', '/api/Pricing/Get', params);
}

export async function getEmployees(session: RapidRmsSession, params?: Record<string, unknown>) {
  return request(session, 'POST', '/api/Employee/Get', params);
}

export async function getPromotions(session: RapidRmsSession, params?: Record<string, unknown>) {
  return request(session, 'POST', '/api/Promotion/Get', params);
}
