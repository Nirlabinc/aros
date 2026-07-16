import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const template = JSON.parse(readFileSync(resolve('config/central-auth-consumer.template.json'), 'utf8'));

describe('central auth consumer template', () => {
  it('pins one HTTPS issuer and its discovery document', () => {
    const issuer = new URL(template.issuer);
    const discovery = new URL(template.discoveryUrl);
    expect(issuer.protocol).toBe('https:');
    expect(discovery.origin).toBe(issuer.origin);
    expect(discovery.pathname).toBe('/.well-known/openid-configuration');
  });

  it('requires PKCE, signed token validation, audience checks and workspace claims', () => {
    expect(template.flow).toBe('authorization_code_pkce');
    expect(template.tokenAlgorithm).toBe('RS256');
    expect(template.requiredClaims).toEqual(expect.arrayContaining(['iss', 'sub', 'aud', 'exp']));
    expect(template.resourceServer).toMatchObject({ verifyIssuer: true, verifyAudience: true });
    expect(template.workspaceClaim).toBeTruthy();
  });

  it('keeps browser tokens out of JavaScript and service credentials out of config', () => {
    expect(template.browser).toMatchObject({ sessionStorage: 'http_only_cookie', secureInProduction: true });
    expect(template.serviceIdentity).toMatchObject({ credentialSource: 'shre-secrets', allowStaticTokenFallback: false });
    const serialized = JSON.stringify(template).toLowerCase();
    expect(serialized).not.toMatch(/clientsecret|client_secret|private_key|bearer [a-z0-9]/);
  });

  it.each(['aros', 'mib', 'sia'])('defines isolated %s client configuration', consumer => {
    const config = template.consumers[consumer];
    expect(config.clientIdEnv).toMatch(/^[A-Z][A-Z0-9_]+$/);
    expect(config.audienceEnv).toMatch(/^[A-Z][A-Z0-9_]+$/);
    expect(config.callbackPath).toBe('/auth/callback');
  });
});
