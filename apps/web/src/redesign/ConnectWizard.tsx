import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { WIZARD_PROVIDERS } from '../lib/posProviders';

const STEP_LABELS = ['PROVIDER', 'CONNECT', 'SCOPE', 'REVIEW'];
const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

/** Outcome the wizard reports: the toast copy must stay honest per outcome. */
export type ConnectOutcome =
  | { status: 'connected'; name: string; found: { store: string; transactionsToday: number } | null }
  | { status: 'saved-unverified'; name: string };

/**
 * Connect-a-register wizard (4 steps): pick provider → credentials → choose
 * stores & access → review. Provider catalogue is shared with the /connect
 * page (lib/posProviders.ts). On connect it POSTs the real connectors API
 * ({type,name,config,secrets}) then runs the connection test and reports the
 * REAL outcome — a failed cloud-testable (kind 'api') test keeps the wizard
 * open with the error; an unconfirmable on-site tunnel reports
 * 'saved-unverified' instead of claiming success.
 */
export function ConnectWizard({ onClose, onDone }: { onClose: () => void; onDone: (outcome: ConnectOutcome) => void }) {
  const { session, tenant } = useAuth();
  const [step, setStep] = useState(1);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const provider = WIZARD_PROVIDERS.find(p => p.id === providerId) || null;

  const authHeaders = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}),
  }), [session, tenant]);

  const canNext =
    step === 1 ? !!provider :
    step === 2 ? !!provider && provider.fields.every(f => f.optional || (values[f.key] || '').trim().length > 0) :
    step === 3 ? true :
    true;

  async function submit() {
    if (!provider) return;
    setBusy(true); setError('');
    try {
      const targetStore = provider.id === 'rapidrms-api' ? String(values.clientId || '') : String(values.commanderIp || '');
      const config: Record<string, unknown> = { stores: targetStore ? [targetStore] : [] };
      const secrets: Record<string, string> = {};
      for (const f of provider.fields) {
        const v = (values[f.key] || '').trim();
        if (f.secret) secrets[f.key] = v; else if (v) config[f.key] = v;
      }
      const saveRes = await fetch(`${API_BASE}/api/connectors`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          type: provider.id,
          name: `${provider.shortName} — ${tenant?.name || 'My Store'}`,
          config,
          secrets,
        }),
      });
      const saved = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) throw new Error(saved.error || `Could not save connector (HTTP ${saveRes.status})`);

      // Run the connection test and report the REAL outcome.
      let testOk = false;
      let found: { store: string; transactionsToday: number } | null = null;
      if (saved.connector?.id) {
        try {
          const testRes = await fetch(`${API_BASE}/api/connectors/test`, {
            method: 'POST', headers: authHeaders(), body: JSON.stringify({ id: saved.connector.id }),
          });
          const testData = await testRes.json().catch(() => ({}));
          testOk = testRes.ok && Boolean(testData.result?.success);
          if (testData.found?.store) found = testData.found;
        } catch { /* treated as unconfirmed below */ }
      }

      if (testOk) {
        onDone({ status: 'connected', name: provider.shortName, found });
      } else if (provider.kind === 'api') {
        // Cloud-testable provider: a failed test is authoritative — keep the
        // wizard open with the draft so the user can fix and retry.
        setError('Saved, but the connection test failed — check the details and hit Connect again.');
      } else {
        // On-site tunnel (e.g. Verifone): a cloud test may legitimately be
        // unable to confirm yet — say so, don't claim success.
        onDone({ status: 'saved-unverified', name: provider.shortName });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function next() {
    if (step < 4) { setStep(step + 1); return; }
    void submit();
  }

  return (
    <div className="rsx-modal" role="dialog" aria-modal="true" aria-label="Connect a register" onClick={onClose}>
      <div className="rsx-modal__card" onClick={e => e.stopPropagation()}>
        <div className="rsx-modal__head">
          <div className="rsx-modal__title">Connect a register</div>
          <button className="rsx-modal__x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="rsx-modal__steps">
          <span className="rsx-modal__stepno">STEP {step} OF 4 · {STEP_LABELS[step - 1]}</span>
          <div className="rsx-modal__track">
            {[1, 2, 3, 4].map(n => <span key={n} className={`rsx-modal__seg ${n <= step ? 'is-on' : ''}`} />)}
          </div>
        </div>

        <div className="rsx-modal__body">
          {step === 1 && (
            <>
              <h3 className="rsx-modal__h">Which POS do you run?</h3>
              <p className="rsx-modal__p">Pick your point-of-sale. We support RapidRMS and Verifone Commander today.</p>
              <div className="rsx-prov">
                {WIZARD_PROVIDERS.map(p => (
                  <button key={p.id} type="button" className={`rsx-prov__card ${providerId === p.id ? 'is-sel' : ''}`} onClick={() => setProviderId(p.id)}>
                    <div className="rsx-prov__mark">{p.mark}</div>
                    <div className="rsx-prov__info">
                      <div className="rsx-prov__name">{p.shortName}{p.tag && <span className="rsx-prov__tag">{p.tag}</span>}</div>
                      <div className="rsx-prov__desc">{p.tagline}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && provider && (
            <>
              <h3 className="rsx-modal__h">Connect {provider.shortName}</h3>
              <p className="rsx-modal__p">{provider.blurb}</p>
              <div className="rsx-form">
                {provider.fields.map(f => (
                  <label key={f.key} className="rsx-form__field">
                    <span className="rsx-form__label">{f.label}{f.optional ? ' (optional)' : ''}</span>
                    <input
                      className="rsx-form__input"
                      type={f.secret && !visibleSecrets[f.key] ? 'password' : f.key === 'email' ? 'email' : 'text'}
                      autoComplete={f.key === 'email' ? 'username' : f.secret ? 'current-password' : 'off'}
                      placeholder={f.placeholder}
                      value={values[f.key] || ''}
                      onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                      aria-describedby={f.hint ? `wiz-${f.key}-hint` : undefined}
                    />
                    {f.secret && <button className="rsx-modal__back" type="button" aria-label={`${visibleSecrets[f.key] ? 'Hide' : 'Show'} ${f.label}`} aria-pressed={Boolean(visibleSecrets[f.key])} onClick={() => setVisibleSecrets(current => ({ ...current, [f.key]: !current[f.key] }))}>{visibleSecrets[f.key] ? 'Hide' : 'Show'}</button>}
                    {f.hint && <span id={`wiz-${f.key}-hint`} style={{ fontSize: 12, color: 'var(--ink-2, #6b7280)', lineHeight: 1.4 }}>{f.hint}</span>}
                  </label>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h3 className="rsx-modal__h">Confirm store &amp; access</h3>
              <p className="rsx-modal__p">{provider?.id === 'rapidrms-api' ? 'A RapidRMS client ID identifies one specific store. We will validate it and add that store. Repeat this flow with another client ID to add another store.' : 'We will validate this Commander and add its site. You can connect another site afterward.'}</p>
              <div className="rsx-scope">
                <div className="rsx-scope__row"><strong>{provider?.id === 'rapidrms-api' ? 'RapidRMS store' : 'Verifone site'}</strong><span>{provider?.id === 'rapidrms-api' ? `Client ID: ${values.clientId}` : `Commander: ${values.commanderIp}`}</span></div>
              </div>
              <div className="rsx-note" style={{ marginTop: 16 }}>
                <div className="rsx-note__body" style={{ opacity: 1 }}>
                  <strong>Read access:</strong> sales, transactions, inventory, and price book.{' '}
                  <strong>Write access:</strong> price changes only, and always with approval.
                </div>
              </div>
            </>
          )}

          {step === 4 && provider && (
            <>
              <h3 className="rsx-modal__h">Review &amp; connect</h3>
              <p className="rsx-modal__p">Confirm the details below. Nothing changes in your stores until you approve it.</p>
              <div className="rsx-review">
                <ReviewRow label="Provider" value={provider.shortName} />
                <ReviewRow label="Connection" value={provider.kind === 'tunnel' ? 'Secure tunnel to site controller' : 'HTTPS API'} />
                <ReviewRow label="Store target" value={provider.id === 'rapidrms-api' ? `Client ID ${values.clientId}` : String(values.commanderIp || '')} />
                <ReviewRow label="Access" value="Read + approval-gated writes" />
              </div>
              {error && <div className="aros-auth__error" style={{ marginTop: 14 }}>{error}</div>}
            </>
          )}
        </div>

        <div className="rsx-modal__foot">
          {step > 1
            ? <button className="rsx-modal__back" onClick={() => setStep(step - 1)} disabled={busy}>← Back</button>
            : <span />}
          <button className="rsx-modal__next" disabled={!canNext || busy} onClick={next}>
            {busy ? `Checking with ${provider?.shortName || 'your POS'}…` : step < 4 ? 'Continue' : `Connect ${provider?.shortName || ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rsx-review__row">
      <span className="rsx-review__k">{label}</span>
      <span className="rsx-review__v">{value}</span>
    </div>
  );
}
