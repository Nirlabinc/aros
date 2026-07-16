import { describe, expect, it } from 'vitest';
import { findHardcodedSecrets, inspectAuthSurface } from '../../security/auth-conformance';

describe('auth conformance rules', () => {
  it('reports every missing JWT claim and algorithm control', () => {
    expect(inspectAuthSurface('const claims = decode(token)', 'jwt-verifier').map(item => item.rule)).toEqual([
      'jwt.signature', 'jwt.issuer', 'jwt.audience', 'jwt.algorithm', 'jwt.expiry',
    ]);
  });
  it('accepts an explicit verifier contract', () => {
    expect(inspectAuthSurface("jwtVerify(token, key, { issuer, audience, algorithms: ['RS256'], maxTokenAge: '5m' })", 'jwt-verifier')).toEqual([]);
  });
  it('requires PKCE, state, and nonce binding together', () => {
    expect(inspectAuthSurface('redirectToAuthorizationEndpoint()', 'oauth-client').map(item => item.rule)).toEqual(['oauth.pkce', 'oauth.state', 'oauth.nonce']);
    expect(inspectAuthSurface('pkce code_challenge code_verifier; state === expectedState; nonce === expectedNonce', 'oauth-client')).toEqual([]);
  });
  it('requires authentication, tenant membership, and authorization', () => {
    expect(inspectAuthSurface('route(request)', 'resource-server').map(item => item.rule)).toEqual(['server.authentication', 'server.tenant-binding', 'server.authorization']);
    expect(inspectAuthSurface("authenticateRequest(); tenant_members.eq('tenant_id', tenantId); if (!role) return 403", 'resource-server')).toEqual([]);
  });
  it('detects common committed credential formats without flagging environment access', () => {
    expect(findHardcodedSecrets("const apiKey = 'sk_live_1234567890abcdefghijkl'")).toHaveLength(2);
    expect(findHardcodedSecrets('const apiKey = process.env.API_KEY')).toHaveLength(0);
  });
});

