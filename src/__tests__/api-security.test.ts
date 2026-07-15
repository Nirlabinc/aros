import { describe, expect, it } from 'vitest';
import { getTrustedClientIp, isPublicRouterPath } from '../api-security.js';

function request(headers: Record<string, string>, remoteAddress = '127.0.0.1') {
  return { headers, socket: { remoteAddress } } as never;
}

describe('API edge security', () => {
  it('ignores forwarded headers unless proxy trust is explicitly enabled', () => {
    const req = request({ 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '198.51.100.1' });
    expect(getTrustedClientIp(req, false)).toBe('127.0.0.1');
    expect(getTrustedClientIp(req, true)).toBe('203.0.113.10');
  });

  it('uses the trusted edge-appended address rather than a spoofed left-most value', () => {
    const req = request({ 'x-forwarded-for': 'attacker-value, 198.51.100.25' });
    expect(getTrustedClientIp(req, true)).toBe('198.51.100.25');
  });

  it('allows only the intentional public router compatibility surface', () => {
    expect(isPublicRouterPath('/v1/chat')).toBe(true);
    expect(isPublicRouterPath('/api/v1/demo/activation')).toBe(true);
    expect(isPublicRouterPath('/v1/admin')).toBe(false);
    expect(isPublicRouterPath('/api/v1/traces/recent')).toBe(false);
  });
});
