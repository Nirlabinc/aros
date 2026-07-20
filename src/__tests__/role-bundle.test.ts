/**
 * Role-bundle derivation for AROS identity — pins the platform convention
 * (shre-id integrations/role-bundles.md) and the AROS-specific legacy
 * fallback (tenant owner/admin ⇒ owner preset, the single-site zero-config
 * rule).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHRE_ID_PROJECT_ID,
  deriveBundle,
  deriveBundleFromClaims,
  fallbackBundleForRole,
  resolveBundle,
} from '../auth/role-bundle';

const PROJECT = DEFAULT_SHRE_ID_PROJECT_ID;
const ROLES_CLAIM = `urn:zitadel:iam:org:project:${PROJECT}:roles`;

describe('deriveBundle (fail closed)', () => {
  it('derives the single bundle role', () => {
    expect(deriveBundle(['openid', 'bundle:store-manager'])).toEqual({
      bundle: 'store-manager',
      candidates: ['store-manager'],
    });
  });

  it('zero or multiple bundle roles derive null', () => {
    expect(deriveBundle(['openid']).bundle).toBeNull();
    const multi = deriveBundle(['bundle:owner', 'bundle:bookkeeper']);
    expect(multi.bundle).toBeNull();
    expect(multi.candidates.sort()).toEqual(['bookkeeper', 'owner']);
  });

  it('a bare prefix is not a bundle', () => {
    expect(deriveBundle(['bundle:']).bundle).toBeNull();
  });
});

describe('deriveBundleFromClaims (audit-H2: own project only)', () => {
  it('reads bundle roles from THIS project claim', () => {
    const claims = { [ROLES_CLAIM]: { 'bundle:shift-lead': { org1: 'x' }, viewer: { org1: 'x' } } };
    expect(deriveBundleFromClaims(claims, PROJECT).bundle).toBe('shift-lead');
  });

  it('ignores other projects and malformed claims', () => {
    expect(
      deriveBundleFromClaims({ 'urn:zitadel:iam:org:project:999:roles': { 'bundle:owner': {} } }, PROJECT).bundle,
    ).toBeNull();
    expect(deriveBundleFromClaims({ [ROLES_CLAIM]: 'not-an-object' }, PROJECT).bundle).toBeNull();
    expect(deriveBundleFromClaims(null, PROJECT).bundle).toBeNull();
  });
});

describe('legacy membership fallback + resolution order', () => {
  it('tenant owner/admin fall back to the owner preset (zero-config rule)', () => {
    expect(fallbackBundleForRole('owner')).toBe('owner');
    expect(fallbackBundleForRole('admin')).toBe('owner');
    expect(fallbackBundleForRole('member')).toBeNull();
    expect(fallbackBundleForRole(undefined)).toBeNull();
  });

  it('Zitadel claims win over the fallback', () => {
    const claims = { [ROLES_CLAIM]: { 'bundle:bookkeeper': { o: 'x' } } };
    expect(resolveBundle(claims, 'owner', PROJECT)).toBe('bookkeeper');
  });

  it('fallback applies when claims name no bundle', () => {
    expect(resolveBundle({}, 'owner', PROJECT)).toBe('owner');
    expect(resolveBundle(null, 'member', PROJECT)).toBeNull();
  });

  it('ambiguous claims do NOT fall through to a wider fallback silently', () => {
    // Two bundle roles = misconfiguration; deriveBundle yields null and the
    // fallback then applies to the MEMBERSHIP role — for a member that is
    // null (restricted), never a bundle picked from the ambiguous pair.
    const claims = { [ROLES_CLAIM]: { 'bundle:owner': {}, 'bundle:shift-lead': {} } };
    expect(resolveBundle(claims, 'member', PROJECT)).toBeNull();
  });
});
