import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  resolveJourneyStep, nextProgressStep, PROGRESS_READINESS, type JourneyStep,
} from '../../onboarding/journey';
import {
  saveOnboardingProgress, completeOnboarding, saveByomProvider,
  fetchConnectors, fetchStoreSummaryConnected, fetchSkills,
  type ModelChoice, type ByomEntry, type ConnectorSummary, type SkillResource,
} from '../../onboarding/api';
import { computeReadiness, type ReadinessItem } from '../../onboarding/readiness';
import { ModelSetupStep } from './ModelSetupStep';
import { ReadinessScreen } from './ReadinessScreen';
import { StoreSetupStep } from './StoreSetupStep';

const STORE_READY = new Set(['connected', 'healthy']);

/**
 * JourneyPage — the resumable onboarding controller for /onboarding.
 *
 * It reads the durable progress (onboarding_progress.step + step_data, resolved
 * by AuthContext) plus live signals (connectors, sync, skills) and renders the
 * right stage: model → connect → readiness. Progress is persisted to the backend
 * at every advance, so the flow resumes correctly on any device.
 *
 * The connect step is intentionally store-by-store: select POS, setup the
 * store, add more stores, then review readiness. This matches how operators
 * actually provision multi-store retailers without blending store identity and
 * POS credentials into one broad form.
 */
export function JourneyPage() {
  const { session, tenant, onboardingStep, onboardingStepData, onboardingLoading, refreshOnboarding, signOut } = useAuth();
  const auth = useMemo(
    () => ({ accessToken: session?.access_token, tenantId: tenant?.id }),
    [session?.access_token, tenant?.id],
  );

  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [storeSummaryConnected, setStoreSummaryConnected] = useState(false);
  const [skills, setSkills] = useState<SkillResource[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [localStage, setLocalStage] = useState<JourneyStep | null>(null);

  const loadSignals = useCallback(async () => {
    setSignalsLoading(true);
    try {
      const [conns, summaryConnected, sk] = await Promise.all([
        fetchConnectors(auth),
        fetchStoreSummaryConnected(auth),
        fetchSkills(auth),
      ]);
      setConnectors(conns);
      setStoreSummaryConnected(summaryConnected);
      setSkills(sk);
    } finally {
      setSignalsLoading(false);
    }
  }, [auth]);

  useEffect(() => { void loadSignals(); }, [loadSignals]);

  const storeConnected = connectors.some((c) => STORE_READY.has(String(c.status)));
  const modelChosen = Boolean(onboardingStepData?.model?.mode);

  // Resolved step from durable progress + live signals; a local override lets a
  // just-completed action advance the view without waiting for a refetch.
  const resolved = resolveJourneyStep(onboardingStep, { modelChosen, storeConnected });
  const stage: JourneyStep = localStage ?? resolved;

  const model = (onboardingStepData?.model as ModelChoice | undefined) ?? null;
  const readiness: ReadinessItem[] = computeReadiness({
    model,
    connectors,
    storeSummaryConnected,
    skills,
  });

  async function handleModelSubmit(choice: ModelChoice, byom?: ByomEntry) {
    setBusy(true);
    try {
      if (byom) await saveByomProvider(byom); // best-effort local sidecar
      await saveOnboardingProgress(auth, nextProgressStep('model'), { model: choice });
      await refreshOnboarding();
      setLocalStage('connect');
    } finally {
      setBusy(false);
    }
  }

  async function skipConnect() {
    setBusy(true);
    try {
      await saveOnboardingProgress(auth, PROGRESS_READINESS, {});
      await refreshOnboarding();
      setLocalStage('readiness');
    } finally {
      setBusy(false);
    }
  }

  async function reviewSetup() {
    setBusy(true);
    try {
      await saveOnboardingProgress(auth, PROGRESS_READINESS, {});
      await loadSignals();
      await refreshOnboarding();
      setLocalStage('readiness');
    } finally {
      setBusy(false);
    }
  }

  async function enterDashboard() {
    setBusy(true);
    try {
      await completeOnboarding(auth, tenant?.name);
      try { localStorage.setItem('aros-onboarding-complete', 'true'); } catch { /* cache only */ }
      await refreshOnboarding();
      window.location.href = '/dashboard';
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = stage === 'model' ? 0 : stage === 'connect' ? 1 : 2;

  if (onboardingLoading || signalsLoading) {
    return (
      <div style={s.wrapper}>
        <div style={s.container}><div style={s.card}>Loading your setup…</div></div>
      </div>
    );
  }

  return (
    <div style={s.wrapper}>
      <div style={s.container}>
        <div style={s.header}>
          <div style={s.logo}>AROS</div>
          <p style={s.tagline}>Let's get your workspace ready</p>
          {/* Pre-onboarding pages have no shell — without this a mid-setup
              user has NO way to sign out anywhere (validation sweep). */}
          <button
            type="button"
            onClick={() => { void signOut().then(() => { window.location.href = '/login'; }); }}
            style={{ position: 'fixed', top: 16, right: 16, background: 'none', border: 'none', color: '#9ca3af', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
          >
            Sign out
          </button>
        </div>

        <div style={s.progress}>
          {['Model', 'Connect store', 'Ready'].map((label, i) => (
            <div key={label} style={s.progressStep}>
              <div style={{ ...s.progressDot, background: i <= stepIndex ? '#3b5bdb' : '#e5e7eb', color: i <= stepIndex ? '#fff' : '#9ca3af' }}>
                {i < stepIndex ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 12, color: i <= stepIndex ? '#1a1a2e' : '#9ca3af', fontWeight: i === stepIndex ? 700 : 400 }}>{label}</span>
            </div>
          ))}
        </div>

        {stage === 'model' && <ModelSetupStep busy={busy} onSubmit={handleModelSubmit} />}

        {stage === 'connect' && (
          <StoreSetupStep
            auth={auth}
            busy={busy}
            onSaved={loadSignals}
            onContinue={reviewSetup}
            onSkip={skipConnect}
          />
        )}

        {stage === 'readiness' && (
          <ReadinessScreen
            items={readiness}
            storeConnected={storeConnected}
            busy={busy}
            onEnterDashboard={() => void enterDashboard()}
            onConnectStore={() => { window.location.href = '/connect'; }}
            onRefresh={() => void loadSignals()}
          />
        )}
      </div>
    </div>
  );
}

const ACCENT = '#3b5bdb';
const s: Record<string, React.CSSProperties> = {
  wrapper: { minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: 'linear-gradient(135deg, #f0f4ff 0%, #e8ecf8 50%, #f5f3ff 100%)', padding: '48px 24px' },
  container: { width: '100%', maxWidth: 860 },
  header: { textAlign: 'center', marginBottom: 24 },
  logo: { fontSize: 28, fontWeight: 800, letterSpacing: -1, color: '#1a1a2e' },
  tagline: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  progress: { display: 'flex', justifyContent: 'center', gap: 40, marginBottom: 32 },
  progressStep: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 },
  progressDot: { width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 },
  card: { background: '#fff', borderRadius: 16, padding: '32px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e5e7eb', maxWidth: 520, margin: '0 auto' },
  cardTitle: { fontSize: 22, fontWeight: 800, color: '#1a1a2e', marginBottom: 8 },
  cardDesc: { fontSize: 14, color: '#6b7280', marginBottom: 24, lineHeight: 1.5 },
  secondary: { flex: 1, padding: '14px 0', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
};
