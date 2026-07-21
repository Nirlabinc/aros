/**
 * Platform-console gate — pure rules, no I/O.
 *
 * v1 gating is a fail-closed server-side allow-list: PLATFORM_ADMIN_EMAILS
 * (comma-separated). Empty/unset ⇒ the console does not exist (routes 404,
 * indistinguishable from no feature). This is deliberately NOT a role in
 * tenant_members — workspace owner is a per-tenant role and must never imply
 * cross-tenant reach. The gate is designed to be swapped for a shre-id role
 * claim later without touching the endpoints.
 */

export function parsePlatformAdmins(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.includes('@')),
  );
}

export function isPlatformAdmin(email: string | null | undefined, admins: Set<string>): boolean {
  if (!email || admins.size === 0) return false;
  return admins.has(email.trim().toLowerCase());
}
