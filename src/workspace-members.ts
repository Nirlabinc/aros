/**
 * Workspace member-addition rules — pure functions (no I/O) so the contract
 * is unit-testable and shared between the API handler and any future UI
 * validation.
 *
 * Deliberate rule: a member can only be ADDED as `admin` or `member` — never
 * directly as `owner`. Ownership is granted explicitly afterwards via the
 * role-change endpoint (which carries the last-owner protection), so a typo
 * in the add form can never mint a second owner.
 */

export const ADDABLE_ROLES = ['admin', 'member'] as const;
export type AddableRole = (typeof ADDABLE_ROLES)[number];

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  // Deliberately loose shape check — the authoritative validation is the
  // lookup against auth.users; this only rejects obvious non-addresses.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function validateAddMemberInput(body: unknown): { email: string; role: AddableRole } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid JSON' };
  const record = body as Record<string, unknown>;
  const email = normalizeEmail(record.email);
  if (!email) return { error: 'A valid email address is required' };
  const role = typeof record.role === 'string' ? record.role : 'member';
  if (!(ADDABLE_ROLES as readonly string[]).includes(role)) {
    return { error: `Role must be one of: ${ADDABLE_ROLES.join(', ')}. Grant ownership afterwards via a role change.` };
  }
  return { email, role: role as AddableRole };
}

/** Message shown when the invitee has no AROS account yet — v1 is
 * registration-first (no email-sending dependency); keep it actionable. */
export const INVITEE_NOT_REGISTERED =
  'No AROS account exists for that email yet. Ask them to sign up at app.aros.live first, then add them here.';
