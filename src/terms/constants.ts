/**
 * Terms / privacy / AI-disclosure version constants.
 *
 * Bump TERMS_VERSION (and PRIVACY_VERSION when the policy changes) on every
 * material update — users are re-gated automatically because acceptance rows
 * are keyed by version. The `-draft` suffix is intentional: replace with the
 * final effective-date version (e.g. "2026-08-01") only after attorney
 * sign-off on the legal copy.
 *
 * The whole consent layer is inert unless the TERMS_GATE_ENABLED env var is
 * truthy ("1"/"true"). Default (absent) = current behavior, unchanged.
 */

export const TERMS_VERSION = '2026-07-17-draft';
export const PRIVACY_VERSION = '2026-07-17-draft';

/** Disclosure key for the first-chat AI popup (§2 of the consent spec). */
export const AI_CHAT_DISCLOSURE_KEY = 'ai-chat-v1';

/** Env flag that turns the whole consent layer on. */
export const TERMS_GATE_FLAG = 'TERMS_GATE_ENABLED';

/**
 * Distinct status returned to authenticated API callers who have not accepted
 * the current terms version while the gate is enabled. 428 Precondition
 * Required is unused elsewhere in the platform, so the frontend can key on it
 * (plus the `code` field) without colliding with 401/403 semantics.
 */
export const TERMS_REQUIRED_STATUS = 428;
export const TERMS_REQUIRED_CODE = 'terms_acceptance_required';

export function isTermsGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[TERMS_GATE_FLAG] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}
