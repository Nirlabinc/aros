/**
 * Clickwrap terms gate (§3 of the consent spec) — flag-gated.
 *
 * Renders children untouched unless the server says the gate is enabled AND
 * the signed-in user has no acceptance for the current terms version. In that
 * case a blocking full-screen overlay demands affirmative assent: an
 * unchecked checkbox naming the Terms + Privacy links, with the primary
 * button disabled until checked. Acceptance is recorded server-side (the
 * server stamps ip / user_agent / timestamp) and the overlay clears.
 *
 * With TERMS_GATE_ENABLED off (default) the status endpoint reports
 * gateEnabled:false and this component is a pass-through — no UX change.
 */

import { ReactNode, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { acceptTerms, useTermsStatus } from '../lib/terms';

export function TermsGate({ children }: { children: ReactNode }) {
  const { session, tenant } = useAuth();
  const accessToken = session?.access_token || null;
  const status = useTermsStatus({ accessToken, tenantId: tenant?.id });
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only bearer-token sessions can record acceptance; unknown status never blocks.
  const mustAccept = !!accessToken && !!status && status.gateEnabled && status.accepted === false;

  const onAgree = async () => {
    if (!checked || submitting) return;
    setSubmitting(true);
    setError(null);
    const ok = await acceptTerms({ accessToken, tenantId: tenant?.id });
    if (!ok) setError('We could not record your acceptance. Please check your connection and try again.');
    setSubmitting(false);
  };

  return (
    <>
      {children}
      {mustAccept && (
        <div style={s.overlay} role="dialog" aria-modal="true" aria-labelledby="terms-gate-title">
          <div style={s.card}>
            <div style={s.brand}>AROS</div>
            <h1 id="terms-gate-title" style={s.title}>
              {status.previouslyAccepted ? 'We’ve updated our terms' : 'Review and accept our terms'}
            </h1>
            {status.previouslyAccepted && (
              <div style={s.changed}>
                <strong>What changed:</strong> our Terms of Service and Privacy Policy were updated —
                including how AI features work and how your data is handled. Please review and accept
                the current version to continue.
              </div>
            )}
            <label style={s.checkRow}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                style={s.checkbox}
                disabled={submitting}
              />
              <span style={s.checkLabel}>
                I have read and agree to the{' '}
                <a href="/legal/terms" target="_blank" rel="noopener noreferrer" style={s.link}>Terms of Service</a>
                {' '}and{' '}
                <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" style={s.link}>Privacy Policy</a>,
                including the use of AI features and the data practices they describe.
              </span>
            </label>
            {error && <div style={s.error} role="alert">{error}</div>}
            <button
              type="button"
              style={{ ...s.agreeBtn, opacity: checked && !submitting ? 1 : 0.45, cursor: checked && !submitting ? 'pointer' : 'not-allowed' }}
              disabled={!checked || submitting}
              onClick={() => void onAgree()}
            >
              {submitting ? 'Saving…' : 'Agree and continue'}
            </button>
            <div style={s.fineprint}>
              Version {status.termsVersion}. If you use AROS on behalf of a business, you confirm you
              have authority to accept for that business.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 10_000,
    background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  card: {
    width: '100%', maxWidth: 520, background: '#fff', borderRadius: 16,
    padding: '32px 32px 24px', boxShadow: '0 24px 64px rgba(15, 23, 42, 0.35)', color: '#1a1a2e',
  },
  brand: { fontWeight: 800, fontSize: 15, letterSpacing: -0.3, color: '#3b5bdb', marginBottom: 12 },
  title: { margin: '0 0 16px', fontSize: 22, fontWeight: 800, lineHeight: 1.3 },
  changed: {
    fontSize: 13, lineHeight: 1.6, background: '#f0f4ff', border: '1px solid #d6def9',
    borderRadius: 10, padding: '10px 14px', marginBottom: 16, color: '#374151',
  },
  checkRow: { display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 18 },
  checkbox: { marginTop: 3, width: 16, height: 16, flexShrink: 0, accentColor: '#3b5bdb' },
  checkLabel: { fontSize: 14, lineHeight: 1.6, color: '#374151' },
  link: { color: '#3b5bdb', fontWeight: 600, textDecoration: 'underline' },
  error: { fontSize: 13, color: '#b91c1c', marginBottom: 12 },
  agreeBtn: {
    width: '100%', border: 0, borderRadius: 10, padding: '12px 16px',
    background: '#3b5bdb', color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
  },
  fineprint: { marginTop: 14, fontSize: 12, lineHeight: 1.5, color: '#9ca3af' },
};
