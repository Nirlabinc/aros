// ── RapidRMS API Connector ──────────────────────────────────────
// Authenticates and communicates with the RapidRMS API.
// Credentials retrieved from vault at auth time — never stored or logged.

import type { RapidRmsApiConfig, RapidRmsSession, ConnectorTestResult } from './types.js';
import { retrieveCredential } from './vault-ref.js';

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
      client_id: String(config.clientId),
      Username: email,
      Password: password,
    }),
  });

  if (!res.ok) {
    throw new Error(`RapidRMS auth failed: ${res.status} ${res.statusText}`);
  }

  const envelope = (await res.json()) as Record<string, unknown>;
  if (envelope.code !== undefined && String(envelope.code) !== '999') {
    throw new Error(`RapidRMS auth rejected the request (code ${String(envelope.code)})`);
  }
  const rawData = envelope.data;
  let parsedData: unknown = rawData || envelope;
  if (typeof parsedData === 'string') {
    try {
      parsedData = JSON.parse(parsedData);
    } catch {
      throw new Error('RapidRMS auth response contained invalid JSON data');
    }
  }
  if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
    throw new Error('RapidRMS auth response did not contain an authentication object');
  }
  const data = parsedData as Record<string, unknown>;
  const token = String(data.access_token ?? '');
  const dbName = String(data.DbName ?? '');
  if (!token || !dbName) throw new Error('RapidRMS auth response did not include token and database context');
  const cookie = res.headers.get('set-cookie') ?? '';
  const timeout = config.sessionTimeout || 420;

  return {
    config,
    dbName,
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

  const url = new URL(path, `${session.config.baseUrl.replace(/\/$/, '')}/`);
  const normalizedMethod = method.toUpperCase();
  if (params && (normalizedMethod === 'GET' || normalizedMethod === 'DELETE')) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  const opts: RequestInit = {
    method: normalizedMethod,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
      DbName: session.dbName,
      Cookie: session.cookie,
    },
  };

  if (params && (normalizedMethod === 'POST' || normalizedMethod === 'PUT' || normalizedMethod === 'PATCH')) {
    opts.body = JSON.stringify(params);
  }

  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new Error(`RapidRMS ${method} ${path}: ${res.status} ${res.statusText}`);
  }

  return res.json();
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

/** Invoice report endpoint used by MIB's production RapidRMS ingestion. */
export async function getInvoiceReport(session: RapidRmsSession, params?: Record<string, unknown>) {
  try {
    return await request(session, 'GET', '/api/InvoiceReport', params);
  } catch (primaryError) {
    try {
      return await request(session, 'GET', '/api/InvoiceReport/GetAllInvoiceByCreatedDate', params);
    } catch {
      throw primaryError;
    }
  }
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
