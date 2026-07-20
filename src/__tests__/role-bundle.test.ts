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

describe('bundle semantics from vendored presets', () => {
  it('vendors exactly the 5 platform presets', async () => {
    const { loadPresetBundles } = await import('../auth/role-bundle');
    expect([...loadPresetBundles().keys()].sort()).toEqual([
      'bookkeeper', 'owner', 'regional', 'shift-lead', 'store-manager',
    ]);
  });

  it('bundleAllowedSkills: wildcard, intersection, exclude-wins, fail closed', async () => {
    const { bundleAllowedSkills } = await import('../auth/role-bundle');
    const catalog = ['shift-recap', 'inventory-count', 'payroll', 'custom-tool'];
    expect(bundleAllowedSkills('owner', catalog)).toEqual(new Set(catalog));
    expect(bundleAllowedSkills('store-manager', catalog)).toEqual(new Set(['shift-recap', 'inventory-count']));
    expect(bundleAllowedSkills('regional', ['sales-report', 'payroll'])).toEqual(new Set(['sales-report']));
    expect(bundleAllowedSkills(null, catalog)).toBeNull();
    expect(bundleAllowedSkills('nope', catalog)).toBeNull();
  });

  it('bundleConnectorMode: enabled set narrows; unmapped defaults read_only; wildcard mode', async () => {
    const { bundleConnectorMode } = await import('../auth/role-bundle');
    expect(bundleConnectorMode('store-manager', 'rapidrms-api')).toBe('read_write');
    expect(bundleConnectorMode('store-manager', 'verifone-commander')).toBe('read_only');
    expect(bundleConnectorMode('store-manager', 'azure-db')).toBeNull(); // not in enabled set
    expect(bundleConnectorMode('owner', 'anything-installed')).toBe('read_write'); // '*' enabled + '*' mode
    expect(bundleConnectorMode('shift-lead', 'rapidrms-api')).toBe('read_only');
    expect(bundleConnectorMode(null, 'rapidrms-api')).toBeNull(); // no bundle = restrict
  });
});

describe('effectiveAppSkills (per-bundle grants: override > preset > none)', () => {
  const APP_SKILLS = ['shift-recap', 'inventory-count', 'payroll', 'sales-report'];

  it('preset rule intersects the app skills', async () => {
    const { effectiveAppSkills } = await import('../auth/role-bundle');
    expect(effectiveAppSkills('store-manager', APP_SKILLS)).toEqual(['shift-recap', 'inventory-count']);
    expect(effectiveAppSkills('owner', APP_SKILLS)).toEqual(APP_SKILLS); // wildcard
  });

  it('tenant role_mapping override replaces the preset rule for that bundle', async () => {
    const { effectiveAppSkills } = await import('../auth/role-bundle');
    const mapping = { 'store-manager': { skills: ['payroll', 'shift-recap'] } };
    expect(effectiveAppSkills('store-manager', APP_SKILLS, mapping)).toEqual(['shift-recap', 'payroll']);
    // Other bundles are untouched by another bundle's override.
    expect(effectiveAppSkills('owner', APP_SKILLS, mapping)).toEqual(APP_SKILLS);
  });

  it('an empty override means none — honored, fail closed', async () => {
    const { effectiveAppSkills } = await import('../auth/role-bundle');
    expect(effectiveAppSkills('store-manager', APP_SKILLS, { 'store-manager': { skills: [] } })).toEqual([]);
  });

  it('no/unknown bundle gets nothing, never the full set', async () => {
    const { effectiveAppSkills } = await import('../auth/role-bundle');
    expect(effectiveAppSkills(null, APP_SKILLS)).toEqual([]);
    expect(effectiveAppSkills('not-a-bundle', APP_SKILLS)).toEqual([]);
  });
});
