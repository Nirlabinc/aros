import { describe, it, expect } from 'vitest';
import { passwordIssue, displayNameIssue } from './profileLogic';

describe('passwordIssue', () => {
  it('rejects short passwords', () => {
    expect(passwordIssue('Ab1', 'Ab1')).toMatch(/at least 10/);
  });
  it('requires letters and a number', () => {
    expect(passwordIssue('abcdefghijk', 'abcdefghijk')).toMatch(/letters and at least one number/);
    expect(passwordIssue('1234567890123', '1234567890123')).toMatch(/letters and at least one number/);
  });
  it('requires matching confirmation', () => {
    expect(passwordIssue('GoodPass123', 'GoodPass124')).toMatch(/do not match/);
  });
  it('accepts a valid pair', () => {
    expect(passwordIssue('GoodPass123', 'GoodPass123')).toBeNull();
  });
});

describe('displayNameIssue', () => {
  it('rejects empty and whitespace-only names', () => {
    expect(displayNameIssue('')).toMatch(/empty/);
    expect(displayNameIssue('   ')).toMatch(/empty/);
  });
  it('rejects names over 80 chars', () => {
    expect(displayNameIssue('x'.repeat(81))).toMatch(/80 characters/);
  });
  it('accepts a normal name', () => {
    expect(displayNameIssue('Ramesh Patel')).toBeNull();
  });
});
