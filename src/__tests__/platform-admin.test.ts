/**
 * Platform-console gate contract: fail-closed on every ambiguous input.
 * A workspace owner role must never imply cross-tenant access — only the
 * explicit allow-list does.
 */
import { describe, expect, it } from 'vitest';
import { parsePlatformAdmins, isPlatformAdmin } from '../platform-admin';

describe('parsePlatformAdmins', () => {
  it('parses a comma-separated list, trimmed and lowercased', () => {
    expect(parsePlatformAdmins(' A@B.co, c@d.io ')).toEqual(new Set(['a@b.co', 'c@d.io']));
  });
  it('empty/unset env means NO admins (console disabled)', () => {
    expect(parsePlatformAdmins(undefined).size).toBe(0);
    expect(parsePlatformAdmins('').size).toBe(0);
  });
  it('drops entries that are not addresses', () => {
    expect(parsePlatformAdmins('true,1,a@b.co')).toEqual(new Set(['a@b.co']));
  });
});

describe('isPlatformAdmin (fail closed)', () => {
  const admins = parsePlatformAdmins('founder@corp.com');
  it('matches case-insensitively', () => {
    expect(isPlatformAdmin('Founder@Corp.COM', admins)).toBe(true);
  });
  it('rejects everyone else', () => {
    expect(isPlatformAdmin('owner@other.com', admins)).toBe(false);
  });
  it('rejects missing email and empty allow-list', () => {
    expect(isPlatformAdmin(null, admins)).toBe(false);
    expect(isPlatformAdmin(undefined, admins)).toBe(false);
    expect(isPlatformAdmin('founder@corp.com', new Set<string>())).toBe(false);
  });
});
