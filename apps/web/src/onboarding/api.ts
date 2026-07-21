/**
 * Thin client for the onboarding journey. Reuses the existing AROS endpoints:
 *   GET  /api/onboarding/status    — resumable progress (durable, cross-device)
 *   POST /api/onboarding/progress  — persist step + step_data mid-journey
 *   POST /api/onboarding/complete  — mark onboarding_completed = true
 *   GET  /api/connectors           — store/POS connection status
 *   GET  /api/store/summary        — live data / sync readiness
 *   GET  /api/resources/skill      — agent skills status
 *   POST /api/settings/models      — BYOM key manager (local sidecar; best-effort)
 */

const API_BASE = (window as unknown as { __AROS_API_URL__?: string }).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

export interface AuthScope { accessToken?: string; tenantId?: string }

function headers(auth: AuthScope): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
    ...(auth.tenantId ? { 'x-aros-tenant-id': auth.tenantId } : {}),
  };
}

async function getJson<T>(path: string, auth: AuthScope): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: headers(auth),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok ? (await res.json()) as T : null;
  } catch {
    return null;
  }
}

export interface ModelChoice { mode: 'recommended' | 'byom'; label?: string; provider?: string; model?: string }

export interface OnboardingStatus {
  completed: boolean;
  step: number;
  stepData: { model?: ModelChoice; [key: string]: unknown };
  canonicalPhase?: string;
}

export async function fetchOnboardingStatus(auth: AuthScope): Promise<OnboardingStatus | null> {
  if (!auth.tenantId) return null;
  const data = await getJson<{ completed?: boolean; step?: number; stepData?: Record<string, unknown>; state?: { phase?: string } }>(
    `/api/onboarding/status?tenantId=${encodeURIComponent(auth.tenantId)}`,
    auth,
  );
  if (!data) return null;
  const phaseStep: Record<string, number> = {
    model_ready: 3,
    store_connected: 4,
    data_syncing: 4,
    capabilities_provisioning: 4,
    ready: 4,
  };
  const legacyStep = typeof data.step === 'number' ? data.step : 1;
  return {
    completed: data.completed === true,
    step: Math.max(legacyStep, phaseStep[data.state?.phase || ''] || 1),
    stepData: (data.stepData as OnboardingStatus['stepData']) || {},
    canonicalPhase: data.state?.phase,
  };
}

/**
 * Persist journey progress. Best-effort: onboarding must never hard-fail if the
 * progress row can't be written (the durable completion flag is what gates the
 * dashboard). Returns whether the write succeeded so callers can surface a hint.
 */
export async function saveOnboardingProgress(
  auth: AuthScope,
  step: number,
  stepData: Record<string, unknown>,
): Promise<boolean> {
  if (!auth.tenantId) return false;
  try {
    const res = await fetch(`${API_BASE}/api/onboarding/progress`, {
      method: 'POST',
      headers: headers(auth),
      body: JSON.stringify({ tenantId: auth.tenantId, step, stepData }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function completeOnboarding(auth: AuthScope, companyName?: string): Promise<boolean> {
  if (!auth.tenantId) return false;
  const res = await fetch(`${API_BASE}/api/onboarding/complete`, {
    method: 'POST',
    headers: headers(auth),
    body: JSON.stringify({ tenantId: auth.tenantId, companyName }),
  });
  return res.ok;
}

export interface ConnectorSummary { status?: string | null; type?: string | null; name?: string | null }

export async function fetchConnectors(auth: AuthScope): Promise<ConnectorSummary[]> {
  const data = await getJson<{ connectors?: ConnectorSummary[] }>('/api/connectors', auth);
  return Array.isArray(data?.connectors) ? data!.connectors : [];
}

export async function fetchStoreSummaryConnected(auth: AuthScope): Promise<boolean> {
  const data = await getJson<{ connected?: boolean }>('/api/store/summary', auth);
  return data?.connected === true;
}

export interface SkillResource { status?: string | null; name?: string | null }

export async function fetchSkills(auth: AuthScope): Promise<SkillResource[]> {
  const data = await getJson<{ resources?: SkillResource[] }>('/api/resources/skill', auth);
  return Array.isArray(data?.resources) ? data!.resources : [];
}

export interface ByomEntry {
  id: string;
  provider: string;
  label: string;
  model: string;
  apiKey?: string;
  endpoint?: string;
  isActive: boolean;
}

/**
 * Register a BYOM provider with the local models sidecar (same contract as the
 * AI Models settings page). Best-effort — the durable record of the choice
 * lives in onboarding_progress.step_data.
 */
export async function saveByomProvider(entry: ByomEntry): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/settings/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providers: [entry], active: entry.id }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
