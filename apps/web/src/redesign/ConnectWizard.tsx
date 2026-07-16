import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { POS_PROVIDERS, STORES_SCOPE, type PosProvider } from './shellData';

const STEP_LABELS = ['PROVIDER', 'CONNECT', 'SCOPE', 'REVIEW'];
const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

/**
 * Connect-a-register wizard (4 steps): pick provider → credentials → choose
 * stores & access → review. POS scoped to RapidRMS + Verifone Commander.
 * On connect it POSTs the real connectors API ({type,name,config,secrets}) then
 * runs the connection test — the same contract as ConnectStorePage.
 */
export function ConnectWizard({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const { session, tenant } = useAuth();
  const [step, setStep] = useState(1);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [stores, setStores] = useState<string[]>(STORES_SCOPE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const provider = POS_PROVIDERS.find(p => p.id === providerId) || null;

  const authHeaders = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}),
  }), [session, tenant]);

  const canNext =
    step === 1 ? !!provider :
    step === 2 ? !!provider && provider.fields.every(f => (values[f.key] || '').trim().length > 0) :
    step === 3 ? stores.length > 0 :
    true;

  function toggleStore(name: string) {
    setStores(all => all.includes(name) ? all.filter(x => x !== name) : [...all, name]);
  }

  async function submit() {
    if (!provider) return;
    setBusy(true); setError('');
    try {
      const config: Record<string, unknown> = { stores };
      const secrets: Record<string, string> = {};
      for (const f of provider.fields) {
        const v = (values[f.key] || '').trim();
        if (f.secret) secrets[f.key] = v; else config[f.key] = v;
      }
      const saveRes = await fetch(`${API_BASE}/api/connectors`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          type: provider.type,
          name: `${provider.name} — ${tenant?.name || 'Five Points'}`,
          config,
          secrets,
        }),
      });
      const saved = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) throw new Error(saved.error || `Could not save connector (HTTP ${saveRes.status})`);
      // Fire the connection test; non-fatal if it can't confirm yet.
      if (saved.connector?.id) {
        await fetch(`${API_BASE}/api/connectors/test`, {
          method: 'POST', headers: authHeaders(), body: JSON.stringify({ id: saved.connector.id }),
        }).catch(() => {});
      }
      onDone(provider.name);
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
                {POS_PROVIDERS.map(p => (
                  <button key={p.id} type="button" className={`rsx-prov__card ${providerId === p.id ? 'is-sel' : ''}`} onClick={() => setProviderId(p.id)}>
                    <div className="rsx-prov__mark">{p.mark}</div>
                    <div className="rsx-prov__info">
                      <div className="rsx-prov__name">{p.name}{p.tag && <span className="rsx-prov__tag">{p.tag}</span>}</div>
                      <div className="rsx-prov__desc">{p.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && provider && (
            <>
              <h3 className="rsx-modal__h">Connect {provider.name}</h3>
              <p className="rsx-modal__p">{provider.blurb}</p>
              <div className="rsx-form">
                {provider.fields.map(f => (
                  <label key={f.key} className="rsx-form__field">
                    <span className="rsx-form__label">{f.label}</span>
                    <input
                      className="rsx-form__input"
                      type={f.secret ? 'password' : 'text'}
                      placeholder={f.ph}
                      value={values[f.key] || ''}
                      onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h3 className="rsx-modal__h">Choose stores &amp; access</h3>
              <p className="rsx-modal__p">Select which locations to sync. You can change scope anytime.</p>
              <div className="rsx-scope">
                {STORES_SCOPE.map(name => (
                  <label key={name} className="rsx-scope__row">
                    <input type="checkbox" checked={stores.includes(name)} onChange={() => toggleStore(name)} />
                    <span>{name}</span>
                  </label>
                ))}
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
                <ReviewRow label="Provider" value={provider.name} />
                <ReviewRow label="Connection" value={provider.kind === 'tunnel' ? 'Secure tunnel to site controller' : 'HTTPS API'} />
                <ReviewRow label="Stores" value={stores.length === STORES_SCOPE.length ? `All ${stores.length}` : stores.join(', ') || 'None'} />
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
            {busy ? 'Connecting…' : step < 4 ? 'Continue' : `Connect ${provider?.name || ''}`}
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

export type { PosProvider };
