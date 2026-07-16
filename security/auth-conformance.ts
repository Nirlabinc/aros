export type AuthSurfaceKind = 'jwt-verifier' | 'oauth-client' | 'resource-server';
export type AuthFinding = { rule: string; message: string };

const has = (source: string, expression: RegExp) => expression.test(source);

export function inspectAuthSurface(source: string, kind: AuthSurfaceKind): AuthFinding[] {
  const findings: AuthFinding[] = [];
  if (kind === 'jwt-verifier') {
    const trustedSdkVerification = has(source, /auth\.getUser\s*\(|jwtVerify\s*\(|verifyJwt\s*\(/i);
    if (!trustedSdkVerification) findings.push({ rule: 'jwt.signature', message: 'Use a trusted JWT verifier; decoding is not verification.' });
    if (!has(source, /issuer|\biss\b/i)) findings.push({ rule: 'jwt.issuer', message: 'Pin and validate the token issuer.' });
    if (!has(source, /audience|\baud\b/i)) findings.push({ rule: 'jwt.audience', message: 'Pin and validate the intended audience.' });
    if (!has(source, /algorithm|algorithms|\balg\b/i)) findings.push({ rule: 'jwt.algorithm', message: 'Allow-list accepted signing algorithms.' });
    if (!has(source, /expiration|expires|\bexp\b|maxTokenAge/i)) findings.push({ rule: 'jwt.expiry', message: 'Reject expired tokens.' });
  }
  if (kind === 'oauth-client') {
    if (!has(source, /code_challenge|codeChallenge|pkce/i) || !has(source, /code_verifier|codeVerifier/i)) findings.push({ rule: 'oauth.pkce', message: 'OAuth authorization-code flows require PKCE S256.' });
    if (!has(source, /\bstate\b/) || !has(source, /timingSafeEqual|constantTime|state\s*[!=]==?/i)) findings.push({ rule: 'oauth.state', message: 'Generate and verify a one-time state value.' });
    if (!has(source, /\bnonce\b/) || !has(source, /nonce\s*[!=]==?|verifyNonce|expectedNonce/i)) findings.push({ rule: 'oauth.nonce', message: 'OIDC flows must bind and verify nonce.' });
  }
  if (kind === 'resource-server') {
    if (!has(source, /authenticateRequest|auth\.getUser|jwtVerify/i)) findings.push({ rule: 'server.authentication', message: 'Authenticate requests on the server.' });
    if (!has(source, /tenant_members|membership|tenantId\s*!==|\.eq\(['"]tenant_id/i)) findings.push({ rule: 'server.tenant-binding', message: 'Bind requested tenant to an active user membership.' });
    if (!has(source, /role|requiredScopes|permission|forbidden|\b403\b/i)) findings.push({ rule: 'server.authorization', message: 'Enforce role/scope authorization server-side.' });
  }
  return findings;
}

const SECRET_PATTERNS = [
  /(?:api[_-]?key|client[_-]?secret|private[_-]?key|access[_-]?token|password)\s*[:=]\s*['"][A-Za-z0-9_+\/=.$-]{16,}['"]/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\b(?:sk_live_|AKIA|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g,
];

export function findHardcodedSecrets(source: string): AuthFinding[] {
  return SECRET_PATTERNS.flatMap(pattern => Array.from(source.matchAll(pattern), () => ({ rule: 'secret.hardcoded', message: 'Move credentials to the scoped secrets vault or CI secret store.' })));
}

