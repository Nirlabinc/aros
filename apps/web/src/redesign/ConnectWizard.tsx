import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { POS_PROVIDERS, type PosProvider } from './shellData';

const STEP_LABELS = ['PROVIDER', 'CONNECT', 'SCOPE', 'REVIEW', 'PAIR EDGE'];
const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

/**
 * Connect-a-register wizard (4 steps): pick provider → credentials → choose
 * stores & access → review. POS scoped to RapidRMS + Verifone Commander.
 * On connect it POSTs the real connectors API ({type,name,config,secrets}) then
 * runs the connection test — the same contract as ConnectStorePage.
 */
export function ConnectWizard({ onClose, onDone }: { onClose: () => void; onDone: (result: { name: string; connected: boolean }) => void }) {
  const { session, tenant } = useAuth();
  const [step, setStep] = useState(1);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [accessMode, setAccessMode] = useState<'read' | 'read_write'>('read');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [edgeActivation, setEdgeActivation] = useState<{ activationCode: string; expiresAt: string } | null>(null);
  const provider = POS_PROVIDERS.find(p => p.id === providerId) || null;

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
      const targetStore = provider.id === 'rapidrms' ? String(values.clientId || '') : String(values.commanderIp || '');
      const config: Record<string, unknown> = { stores: targetStore ? [targetStore] : [], accessMode };
      const secrets: Record<string, string> = {};
      for (const f of provider.fields) {
        const v = (values[f.key] || '').trim();
        if (!v) continue;
        if (f.secret) secrets[f.key] = v; else config[f.key] = v;
      }
      const saveRes = await fetch(`${API_BASE}/api/connectors`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          type: provider.type,
          name: provider.id === 'verifone' ? String(values.storeName).trim() : `${provider.name} — ${tenant?.name || 'Five Points'}`,
          config,
          secrets,
        }),
      });
      const saved = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) throw new Error(saved.error || `Could not save connector (HTTP ${saveRes.status})`);
      if (provider.id === 'verifone') {
        if (!saved.edgeActivation?.activationCode) throw new Error('The store was saved, but an Edge pairing code could not be created.');
        setEdgeActivation(saved.edgeActivation); setStep(5); return;
      }
      // Cloud APIs can be tested here. Commander is LAN-only and is verified
      // by the paired Edge Relay on the store computer.
      if (saved.connector?.id && provider.id !== 'verifone') {
        const testRes = await fetch(`${API_BASE}/api/connectors/test`, {
          method: 'POST', headers: authHeaders(), body: JSON.stringify({ id: saved.connector.id }),
        });
        const tested = await testRes.json().catch(() => ({}));
        if (!testRes.ok || !tested.result?.success) throw new Error(tested.error || tested.result?.error || 'The connection test failed.');
      }
      onDone({ name: provider.id === 'verifone' ? String(values.storeName).trim() : provider.name, connected: provider.id !== 'verifone' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function next() {
    if (step === 5) { onDone({ name: String(values.storeName).trim(), connected: false }); return; }
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
          <span className="rsx-modal__stepno">STEP {step} OF {provider?.id === 'verifone' ? 5 : 4} · {STEP_LABELS[step - 1]}</span>
          <div className="rsx-modal__track">
            {(provider?.id === 'verifone' ? [1, 2, 3, 4, 5] : [1, 2, 3, 4]).map(n => <span key={n} className={`rsx-modal__seg ${n <= step ? 'is-on' : ''}`} />)}
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
                    <span className="rsx-secret"><input
                      className="rsx-form__input"
                      type={f.secret && !visibleSecrets[f.key] ? 'password' : f.key === 'email' ? 'email' : 'text'}
                      autoComplete={f.key === 'email' ? 'username' : f.secret ? 'current-password' : 'off'}
                      placeholder={f.ph}
                      value={values[f.key] || ''}
                      onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                    />
                    {f.secret && <button className="rsx-secret__toggle" type="button" aria-label={`${visibleSecrets[f.key] ? 'Hide' : 'Show'} ${f.label}`} aria-pressed={Boolean(visibleSecrets[f.key])} onClick={() => setVisibleSecrets(current => ({ ...current, [f.key]: !current[f.key] }))}>{visibleSecrets[f.key] ? 'Hide' : 'Show'}</button>}</span>
                  </label>
                ))}
              </div>
              {provider.id === 'verifone' && <div className="rsx-note" style={{ marginTop: 16 }}><div className="rsx-note__title">AROS Edge is required for cloud access</div><div className="rsx-note__body">Install Edge Relay on a Windows computer that stays on at this store and can reach Commander. Commander credentials and local database settings are completed on that computer, not exposed to the public internet. <a href="/verifone/download.html" target="_blank" rel="noreferrer">Open Edge installer</a>.</div></div>}
            </>
          )}

          {step === 3 && (
            <>
              <h3 className="rsx-modal__h">Confirm store &amp; access</h3>
              <p className="rsx-modal__p">{provider?.id === 'rapidrms' ? 'A RapidRMS client ID identifies one specific store. We will validate it and add that store. Repeat this flow with another client ID to add another store.' : 'We will save this site as pending. Install and pair AROS Edge at the store; Edge will verify Commander and complete the first read-only sync.'}</p>
              <div className="rsx-scope">
                <div className="rsx-scope__row"><strong>{provider?.id === 'rapidrms' ? 'RapidRMS store' : values.storeName}</strong><span>{provider?.id === 'rapidrms' ? `Client ID: ${values.clientId}` : `${values.storeNumber ? `Store #${values.storeNumber} · ` : ''}Commander ${values.commanderIp}`}</span></div>
                <label className="rsx-scope__row"><input type="radio" name="access" checked={accessMode === 'read'} onChange={() => setAccessMode('read')} /><span><strong>Read only</strong><br />Sales, inventory, transactions, and reporting.</span></label>
                <label className="rsx-scope__row"><input type="radio" name="access" checked={accessMode === 'read_write'} onChange={() => setAccessMode('read_write')} /><span><strong>Read + write</strong><br />Proposed changes remain approval-gated.</span></label>
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
                <ReviewRow label="Connection" value={provider.kind === 'tunnel' ? 'AROS Edge · outbound secure connection' : 'HTTPS API'} />
                <ReviewRow label="Store" value={provider.id === 'rapidrms' ? `Client ID ${values.clientId}` : `${values.storeName}${values.storeNumber ? ` (#${values.storeNumber})` : ''}`} />
                {provider.id === 'verifone' && <ReviewRow label="Next step" value="Install and pair Edge Relay at this store" />}
                <ReviewRow label="Access" value={accessMode === 'read' ? 'Read only' : 'Read + approval-gated writes'} />
              </div>
              {error && <div className="aros-auth__error" style={{ marginTop: 14 }}>{error}</div>}
            </>
          )}
          {step === 5 && provider?.id === 'verifone' && edgeActivation && <><h3 className="rsx-modal__h">Pair AROS Edge</h3><p className="rsx-modal__p">Use this one-time code on the store computer. It expires {new Date(edgeActivation.expiresAt).toLocaleString()}.</p><div className="rsx-edge-code">{edgeActivation.activationCode}</div><ol className="rsx-edge-steps"><li>On the store computer, open the <a href="/verifone/download.html" target="_blank" rel="noreferrer">Edge Relay installer</a>.</li><li>Install AROS Edge and enter this pairing code.</li><li>In the local setup page, enter Commander IP and credentials and select the local reporting database if CStoreSKU uses one.</li><li>Run the Commander test and initial read-only sync. This store changes from Pending to Connected after Edge reports healthy.</li></ol><div className="rsx-note"><div className="rsx-note__body">The store computer makes the outbound encrypted connection. Commander and its database are never exposed directly through Cloudflare.</div></div></>}
        </div>

        <div className="rsx-modal__foot">
          {step > 1 && step < 5
            ? <button className="rsx-modal__back" onClick={() => setStep(step - 1)} disabled={busy}>← Back</button>
            : <span />}
          <button className="rsx-modal__next" disabled={!canNext || busy} onClick={next}>
            {busy ? 'Connecting…' : step === 5 ? 'Finish' : step < 4 ? 'Continue' : provider?.id === 'verifone' ? 'Create store & pairing code' : `Connect ${provider?.name || ''}`}
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
