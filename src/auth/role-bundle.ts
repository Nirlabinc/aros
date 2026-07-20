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
