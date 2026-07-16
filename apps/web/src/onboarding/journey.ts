/**
 * Onboarding journey — the single source of truth for "where should this
 * session go?". Pure, framework-free, and unit-tested so the routing rules can
 * be reasoned about in one place instead of being scattered across App.tsx,
 * ProtectedRoute, and the individual pages.
 *
 * The cohesive journey is: start → model → connect → readiness → dashboard.
 *
 *   start      value-first demo chat (/start) — ONLY for genuinely new workspaces
 *   model      choose the AROS-managed recommended model or bring your own
 *   connect    connect one store / POS (reuses the real /connect page + API)
 *   readiness  model / store / sync / skills status, then enter the dashboard
 *
 * Progress is durable and resumable across devices because it is persisted in
 * the backend `onboarding_progress` row (read via GET /api/onboarding/status,
 * written via POST /api/onboarding/progress) — never only in localStorage.
 */

export type JourneyStep = 'model' | 'connect' | 'readiness';

/**
 * Backend `onboarding_progress.step` is a 1-based integer. We map it to the
 * journey so the furthest-reached step survives a browser/device change.
 *
 *   1  brand new (signup) → still at /start
 *   2  reached the model step
 *   3  reached the connect step
 *   4  reached readiness (and, once completed, onboarding_completed = true)
 */
export const PROGRESS_START = 1;
export const PROGRESS_MODEL = 2;
export const PROGRESS_CONNECT = 3;
export const PROGRESS_READINESS = 4;

export const STEP_TO_PROGRESS: Record<JourneyStep, number> = {
  model: PROGRESS_MODEL,
  connect: PROGRESS_CONNECT,
  readiness: PROGRESS_READINESS,
};

function normalizeProgress(progressStep: number | null | undefined): number {
  if (typeof progressStep !== 'number' || !Number.isFinite(progressStep)) return PROGRESS_START;
  if (progressStep < PROGRESS_START) return PROGRESS_START;
  if (progressStep > PROGRESS_READINESS) return PROGRESS_READINESS;
  return Math.floor(progressStep);
}

/** True when the persisted step shows the workspace has begun setup (past /start). */
export function hasStartedJourney(progressStep: number | null | undefined): boolean {
  return normalizeProgress(progressStep) > PROGRESS_START;
}

export interface LandingInput {
  loading: boolean;
  hasSession: boolean;
  /** tenant.onboarding_completed — the durable, cross-device signal. */
  onboardingCompleted: boolean;
  /** A failed membership lookup is NOT evidence of a new workspace. */
  membershipError: boolean;
  /** Persisted onboarding_progress.step; null when not yet loaded/known. */
  progressStep: number | null;
}

/**
 * Where an authenticated session should land. Returns null while auth is still
 * loading (the caller should keep showing its spinner rather than redirect).
 */
export function resolveAuthenticatedLanding(input: LandingInput): string | null {
  if (input.loading) return null;
  if (!input.hasSession) return '/login';

  // Established, onboarded workspaces ALWAYS resolve to the dashboard — even on
  // a fresh device with empty local caches — because onboardingCompleted comes
  // from the backend tenant/membership record, not localStorage.
  if (input.onboardingCompleted) return '/dashboard';

  // A transient membership-lookup failure must not restart onboarding for an
  // established user. Route to the dashboard so ProtectedRoute can retry.
  if (input.membershipError) return '/dashboard';

  // Genuinely new workspace (no recorded progress) → value-first demo chat.
  if (!hasStartedJourney(input.progressStep)) return '/start';

  // Mid-journey → resume inside the setup flow.
  return '/onboarding';
}

export interface JourneySignals {
  /** The user has made a model choice (recommended or BYOM). */
  modelChosen: boolean;
  /** At least one store/POS connector is live. */
  storeConnected: boolean;
}

/**
 * Which sub-step the resumable /onboarding controller should render. Combines
 * the persisted furthest step (a floor) with live signals, so a completed
 * action still advances the user even if a single progress write was lost.
 */
export function resolveJourneyStep(
  progressStep: number | null | undefined,
  signals: JourneySignals,
): JourneyStep {
  const persisted = normalizeProgress(progressStep);

  // A connected store is the strongest signal that setup is essentially done —
  // surface readiness so they can review status and enter the dashboard.
  if (signals.storeConnected || persisted >= PROGRESS_READINESS) return 'readiness';

  // Model chosen (or persisted past it) but no store yet → the connect step.
  if (signals.modelChosen || persisted >= PROGRESS_CONNECT) return 'connect';

  return 'model';
}

/** The step to persist when the user advances from `current`. */
export function nextProgressStep(current: JourneyStep): number {
  if (current === 'model') return PROGRESS_CONNECT;
  if (current === 'connect') return PROGRESS_READINESS;
  return PROGRESS_READINESS;
}
