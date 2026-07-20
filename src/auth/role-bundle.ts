/**
 * Role-bundle derivation — AROS side of the platform role-bundle contract
 * (shreai `shre-rapidrms/contracts/platform/role-bundle.v1.schema.json`;
 * identity convention: shre-id `integrations/role-bundles.md`).
 *
 * Two sources, in order:
 *
 * 1. **Zitadel project roles** (shre-id OIDC sessions): role key
 *    `bundle:<id>` == bundle id, exactly one per user per project. Read ONLY
 *    from THIS project's claim (`urn:zitadel:iam:org:project:<id>:roles`) —
 *    a token can carry other projects' roles; harvesting them is a
 *    cross-tenant confusion bug (shre-id audit H2). Fail closed: zero or
 *    multiple bundle roles → null.
 *
 * 2. **Legacy membership fallback** (Supabase-auth users with no Zitadel
 *    claims): tenant owners/admins map to the `owner` preset — the
 *    single-site zero-config rule ("owner bundle auto-assigned"), matching
 *    the existing owner/admin equivalence in `canManageMarketplace`. Every
 *    other membership role maps to null (most-restricted once enforcement
 *    consumes the bundle; today the field is carried, not yet enforced).
 *
 * Pure module — no I/O, no env reads; callers pass the project id.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const BUNDLE_ROLE_PREFIX = 'bundle:';

/** The aros application project in shre-id (integrations/aros/README). */
export const DEFAULT_SHRE_ID_PROJECT_ID = '381304431301361668';

export interface BundleDerivation {
  /** Single derived bundle id, or null (none / ambiguous → fail closed). */
  bundle: string | null;
  /** Every bundle:* role seen — diagnostics only, never auto-picked. */
  candidates: string[];
}

export function deriveBundle(roles: Iterable<string>): BundleDerivation {
  const candidates: string[] = [];
  for (const role of roles) {
    if (role.startsWith(BUNDLE_ROLE_PREFIX) && role.length > BUNDLE_ROLE_PREFIX.length) {
      candidates.push(role.slice(BUNDLE_ROLE_PREFIX.length));
    }
  }
  return { bundle: candidates.length === 1 ? candidates[0]! : null, candidates };
}

/** Read THIS project's Zitadel roles claim and derive the bundle (audit H2). */
export function deriveBundleFromClaims(
  claims: Record<string, unknown> | null | undefined,
  projectId: string,
): BundleDerivation {
  const roleClaim = claims?.[`urn:zitadel:iam:org:project:${projectId}:roles`];
  if (!roleClaim || typeof roleClaim !== 'object' || Array.isArray(roleClaim)) {
    return { bundle: null, candidates: [] };
  }
  return deriveBundle(Object.keys(roleClaim as Record<string, unknown>));
}

/** Legacy-membership fallback: tenant owner/admin ⇒ owner preset, else null. */
export function fallbackBundleForRole(membershipRole: string | null | undefined): string | null {
  return membershipRole === 'owner' || membershipRole === 'admin' ? 'owner' : null;
}

/**
 * The one resolution rule every AROS auth path uses: Zitadel claims win when
 * they name a bundle; otherwise the legacy membership fallback applies.
 */
export function resolveBundle(
  claims: Record<string, unknown> | null | undefined,
  membershipRole: string | null | undefined,
  projectId: string,
): string | null {
  const fromClaims = deriveBundleFromClaims(claims, projectId).bundle;
  return fromClaims ?? fallbackBundleForRole(membershipRole);
}

// ── Bundle semantics (vendored contract data) ───────────────────────────────
// The preset bundle documents are VENDORED at contracts/platform/presets
// (source of truth: shreai shre-rapidrms/contracts/platform; same vendoring
// flow as MIB #92 and Sia #211). #100 carried the bundle ID; these helpers
// give it MEANING: what a bundle may see and in which mode. Semantics mirror
// Sia's role_bundle_service — one behavior on every consumer.

export interface RoleBundleDoc {
  bundle: string;
  version: number;
  skills: { include: string[]; exclude?: string[] };
  connectors: { enabled: string[]; mode?: Record<string, string> };
  data_scope: { entities: string[]; scope: string };
  risk_ceiling: string;
  [key: string]: unknown;
}

const PRESETS_DIR =
  process.env.ROLE_BUNDLE_PRESETS_DIR ||
  join(import.meta.dirname ?? __dirname, '../../contracts/platform/presets');

let presetCache: Map<string, RoleBundleDoc> | null = null;

export function loadPresetBundles(): Map<string, RoleBundleDoc> {
  if (presetCache) return presetCache;
  const out = new Map<string, RoleBundleDoc>();
  try {
    for (const file of readdirSync(PRESETS_DIR)) {
      if (!/^[\w-]+\.v\d+\.json$/.test(file)) continue;
      const doc = JSON.parse(readFileSync(join(PRESETS_DIR, file), 'utf8')) as RoleBundleDoc;
      out.set(doc.bundle, doc);
    }
  } catch {
    // Unreadable presets = no semantics = every helper fails closed below.
  }
  presetCache = out;
  return out;
}

/** Test hook: drop the preset cache (after changing ROLE_BUNDLE_PRESETS_DIR). */
export function resetPresetCache(): void {
  presetCache = null;
}

/**
 * Skills/tools from `catalog` this bundle may see. `null` when the bundle is
 * unknown/absent — the caller picks the restricted default (fail closed,
 * never the full catalog). `'*'` selects the whole catalog; exclude wins.
 */
export function bundleAllowedSkills(bundleId: string | null, catalog: Iterable<string>): Set<string> | null {
  const doc = bundleId ? loadPresetBundles().get(bundleId) : undefined;
  if (!doc) return null;
  const include = doc.skills?.include ?? [];
  const exclude = new Set(doc.skills?.exclude ?? []);
  const names = new Set(catalog);
  const allowed = include.includes('*') ? names : new Set([...names].filter(n => include.includes(n)));
  for (const e of exclude) allowed.delete(e);
  return allowed;
}

/** The bundle's data-scope level; unknown/absent bundle ⇒ most restricted. */
export function bundleDataScope(bundleId: string | null): 'assigned_sites' | 'region' | 'division' | 'all' {
  const doc = bundleId ? loadPresetBundles().get(bundleId) : undefined;
  const scope = doc?.data_scope?.scope;
  return scope === 'all' || scope === 'region' || scope === 'division' ? scope : 'assigned_sites';
}

/**
 * Which of the tenant's stores this caller may reach (role-bundle
 * data_scope × per-member assignment).
 *
 * - scope 'all' → every tenant store.
 * - site-level scopes ('assigned_sites'; 'region'/'division' resolve the same
 *   until a region model exists) → the member's assigned stores — WITH the
 *   adoption gate: a tenant with zero assignment rows anywhere has not
 *   adopted site scoping, so site-scoped bundles see all stores (nothing
 *   breaks for existing tenants). Once the tenant assigns ANY member,
 *   enforcement is strict: unassigned site-scoped members see NOTHING.
 */
export function filterStoresForBundle(
  bundleId: string | null,
  tenantStoreIds: readonly string[],
  memberAssignedIds: readonly string[],
  tenantHasAssignments: boolean,
): string[] {
  if (bundleDataScope(bundleId) === 'all') return [...tenantStoreIds];
  if (!tenantHasAssignments) return [...tenantStoreIds]; // adoption gate
  const assigned = new Set(memberAssignedIds);
  return tenantStoreIds.filter(id => assigned.has(id));
}

/**
 * Per-bundle effective skills for one app (task: per-bundle grants).
 *
 * Resolution order:
 * 1. Tenant override — `marketplace_app_entitlements.role_mapping` shaped
 *    `{ "<bundle-id>": { "skills": ["name", …] } }`. When present for the
 *    caller's bundle it REPLACES the preset rule for this app (this is how
 *    a tenant narrows or widens one app for one role without forking
 *    presets). An empty override list means none — fail closed, honored.
 * 2. Preset rule — `bundleAllowedSkills` over the app's skill names.
 * 3. No/unknown bundle — empty (most restricted), never the full set.
 */
export function effectiveAppSkills(
  bundleId: string | null,
  appSkillNames: readonly string[],
  roleMapping?: Record<string, { skills?: string[] }> | null,
): string[] {
  const override = bundleId ? roleMapping?.[bundleId]?.skills : undefined;
  if (Array.isArray(override)) return appSkillNames.filter(name => override.includes(name));
  const allowed = bundleAllowedSkills(bundleId, appSkillNames);
  return allowed ? appSkillNames.filter(name => allowed.has(name)) : [];
}

/**
 * Is this connector surfaced to the bundle, and in which mode?
 * Rules (contract §connectors): a bundle can only narrow the tenant's
 * installed set; enabled-but-unmapped connectors default to read_only
 * (fail closed); `'*'` wildcards in enabled/mode are owner-class.
 * Unknown/absent bundle ⇒ null (caller restricts).
 */
export function bundleConnectorMode(
  bundleId: string | null,
  connectorId: string,
): 'read_only' | 'read_write' | null {
  const doc = bundleId ? loadPresetBundles().get(bundleId) : undefined;
  if (!doc) return null;
  const enabled = doc.connectors?.enabled ?? [];
  if (!enabled.includes('*') && !enabled.includes(connectorId)) return null;
  const mode = doc.connectors?.mode?.[connectorId] ?? doc.connectors?.mode?.['*'];
  return mode === 'read_write' ? 'read_write' : 'read_only';
}
