import { createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import { assertApplicationClaims, parseApplicationIdentity, type ApplicationIdentity } from 'shre-sdk/application-identity';
import { createMemoryOidcStore, type OidcStore, type StoredSession } from './oidc-store.js';

export const AROS_APPLICATION: ApplicationIdentity = parseApplicationIdentity({
  id: 'aros-web', displayName: 'AROS', kind: 'first-party', status: 'active', issuer: 'https://id.shre.ai',
  audiences: ['aros-api'], redirectUris: ['https://app.aros.live/auth/callback'], allowedOrigins: ['https://app.aros.live'],
  requiredScopes: ['openid'], tokenAuthMethod: 'none', version: 1,
});

export type WorkspaceAccess = { workspaceId: string; role: string };
export type OidcSession = { id: string; subject: string; workspaceId: string; role: string; claims: JWTPayload; refreshToken?: string; expiresAt: number };
type Transaction = { verifier: string; nonce: string; browser: string; returnTo: string; expiresAt: number };
type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; revocation_endpoint?: string; end_session_endpoint?: string };

export interface OidcRpOptions {
  application?: ApplicationIdentity;
  redirectUri?: string;
  sessionTtlMs?: number;
  fetcher?: typeof fetch;
  mapWorkspace: (subject: string, requestedWorkspace: string | undefined, claims: JWTPayload) => Promise<WorkspaceAccess | null>;
  now?: () => number;
  store?: OidcStore;
}

const b64 = (size = 32) => randomBytes(size).toString('base64url');
const sha = (value: string) => createHash('sha256').update(value).digest('base64url');
const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const safeReturn = (value?: string) => value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/dashboard';

export function createOidcRelyingParty(options: OidcRpOptions) {
  const application = options.application || AROS_APPLICATION;
  const redirectUri = options.redirectUri || application.redirectUris[0];
  if (!application.redirectUris.includes(redirectUri)) throw new Error('OIDC redirect URI is not registered');
  const fetcher = options.fetcher || fetch; const now = options.now || Date.now; const store = options.store || createMemoryOidcStore();
  let discoveryCache: Discovery | undefined;
  async function discovery() { if (discoveryCache) return discoveryCache; const response = await fetcher(`${application.issuer}/.well-known/openid-configuration`); if (!response.ok) throw new Error('OIDC discovery unavailable'); const value = await response.json() as Discovery; if (value.issuer !== application.issuer) throw new Error('OIDC discovery issuer mismatch'); discoveryCache = value; return value; }
  function browserCookie(raw = '') { return /(?:^|;\s*)aros_oidc_browser=([^;]+)/.exec(raw)?.[1]; }
  function sessionCookie(raw = '') { return /(?:^|;\s*)aros_session=([^;]+)/.exec(raw)?.[1]; }

  async function begin(input: { cookie?: string; returnTo?: string; workspaceId?: string }) {
    const metadata = await discovery(); const state = b64(); const verifier = b64(48); const nonce = b64(); const browser = browserCookie(input.cookie) || b64();
    await store.putTransaction(sha(state), sha(browser), { verifier, nonce, returnTo: safeReturn(input.returnTo), expiresAt: now() + 600_000 });
    const url = new URL(metadata.authorization_endpoint); url.search = new URLSearchParams({ response_type: 'code', client_id: application.id, redirect_uri: redirectUri, scope: 'openid profile email', state, nonce, code_challenge: sha(verifier), code_challenge_method: 'S256', ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}) }).toString();
    return { location: url.toString(), setCookie: cookie('aros_oidc_browser', browser, 600) };
  }

  async function callback(input: { code?: string; state?: string; cookie?: string }) {
    if (!input.code || !input.state) throw new Error('Missing authorization response');
    const key = sha(input.state);
    const browser = browserCookie(input.cookie);
    const transaction = browser ? await store.consumeTransaction(key, sha(browser), now()) : null;
    if (!transaction) throw new Error('Invalid or expired OIDC state');
    const metadata = await discovery(); const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: application.id, code: input.code, redirect_uri: redirectUri, code_verifier: transaction.verifier });
    const response = await fetcher(metadata.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const tokens = await response.json() as { id_token?: string; access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
    if (!response.ok || !tokens.id_token) throw new Error(tokens.error || 'OIDC token exchange failed');
    const jwksResponse = await fetcher(metadata.jwks_uri); if (!jwksResponse.ok) throw new Error('OIDC JWKS unavailable');
    const verified = await jwtVerify(tokens.id_token, createLocalJWKSet(await jwksResponse.json() as JSONWebKeySet), { issuer: application.issuer, audience: application.audiences, algorithms: ['RS256'], clockTolerance: 5 });
    assertApplicationClaims(application, verified.payload);
    if (verified.payload.nonce !== transaction.nonce) throw new Error('OIDC nonce mismatch');
    const subject = verified.payload.sub; if (!subject) throw new Error('OIDC subject missing');
    const requestedWorkspace = typeof verified.payload.workspace_id === 'string' ? verified.payload.workspace_id : typeof verified.payload.tenant_id === 'string' ? verified.payload.tenant_id : undefined;
    const access = await options.mapWorkspace(subject, requestedWorkspace, verified.payload); if (!access) throw new Error('Workspace access denied');
    const opaque = b64(48); const id = sha(opaque); const stored: StoredSession = { subject, workspaceId: access.workspaceId, role: access.role, claims: verified.payload, refreshToken: tokens.refresh_token, expiresAt: now() + Math.min((tokens.expires_in || 3600) * 1000, options.sessionTtlMs || 3_600_000) }; await store.putSession(id, stored);
    return { session: { id, ...stored } as OidcSession, location: transaction.returnTo, setCookie: cookie('aros_session', opaque, Math.floor((options.sessionTtlMs || 3_600_000) / 1000)) };
  }

  async function authenticate(rawCookie?: string) { const opaque = sessionCookie(rawCookie); if (!opaque) return null; const id = sha(opaque); const value = await store.getSession(id, now()); return value ? { id, ...value } as OidcSession : null; }
  function authorize(session: OidcSession | null, workspaceId: string, roles: string[] = []) { return Boolean(session && session.workspaceId === workspaceId && (!roles.length || roles.includes(session.role))); }
  async function logout(rawCookie?: string) { const opaque = sessionCookie(rawCookie); const value = opaque ? await store.revokeSession(sha(opaque)) : null; if (value?.refreshToken) { const metadata = await discovery(); if (metadata.revocation_endpoint) await fetcher(metadata.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: value.refreshToken, token_type_hint: 'refresh_token', client_id: application.id }) }).catch(() => undefined); } return { setCookie: cookie('aros_session', '', 0) }; }
  return { begin, callback, authenticate, authorize, logout };
}
