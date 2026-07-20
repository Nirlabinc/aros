/**
 * Add-member contract: role ceiling (never direct owner), email
 * normalization, and the registration-first invitee message.
 */
import { describe, expect, it } from 'vitest';
import { normalizeEmail, validateAddMemberInput, INVITEE_NOT_REGISTERED } from '../workspace-members';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Staff@Store.COM ')).toBe('staff@store.com');
  });
  it('rejects non-addresses', () => {
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});

describe('validateAddMemberInput', () => {
  it('accepts admin and member roles', () => {
    expect(validateAddMemberInput({ email: 'a@b.co', role: 'admin' })).toEqual({ email: 'a@b.co', role: 'admin' });
    expect(validateAddMemberInput({ email: 'a@b.co', role: 'member' })).toEqual({ email: 'a@b.co', role: 'member' });
  });
  it('defaults to member when role omitted', () => {
    expect(validateAddMemberInput({ email: 'a@b.co' })).toEqual({ email: 'a@b.co', role: 'member' });
  });
  it('never allows adding someone directly as owner', () => {
    const result = validateAddMemberInput({ email: 'a@b.co', role: 'owner' });
    expect('error' in result && result.error).toMatch(/role change/i);
  });
  it('rejects a missing or malformed email with a clear error', () => {
    const result = validateAddMemberInput({ role: 'member' });
    expect('error' in result && result.error).toMatch(/email/i);
  });
});

describe('INVITEE_NOT_REGISTERED', () => {
  it('tells the owner exactly what to do next', () => {
    expect(INVITEE_NOT_REGISTERED).toContain('app.aros.live');
  });
});
