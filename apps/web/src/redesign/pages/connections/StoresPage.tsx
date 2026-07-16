import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { createStore, listStores, listStoreSyncs, removeStore, startStoreSync, testStore, type StoreConnector, type StoreConnectorType, type StoreSyncJob } from './api';

const PROVIDERS: Record<StoreConnectorType, { name: string; description: string; fields: Array<{ key: string; label: string; secret?: boolean; optional?: boolean }> }> = {
  'rapidrms-api': { name: 'RapidRMS', description: 'Sales, inventory, pricing, and promotions.', fields: [{ key: 'clientId', label: 'Client ID' }, { key: 'email', label: 'Account email', secret: true }, { key: 'password', label: 'Password', secret: true }] },
  'verifone-commander': { name: 'Verifone Commander', description: 'Fuel and convenience-store operations.', fields: [{ key: 'commanderIp', label: 'Commander IP or hostname' }, { key: 'username', label: 'CGI username' }, { key: 'password', label: 'Password', secret: true }] },
  'azure-db': { name: 'Azure SQL', description: 'Secure access to back-office operational data.', fields: [{ key: 'server', label: 'Server' }, { key: 'database', label: 'Database' }, { key: 'username', label: 'Username' }, { key: 'port', label: 'Port', optional: true }, { key: 'password', label: 'Password', secret: true }] },
};

export function StoresPage({ onConnect }: { onConnect?: () => void }) {
  const { session, tenant } = useAuth();
  const auth = useMemo(() => ({ accessToken: session?.access_token, tenantId: tenant?.id }), [session?.access_token, tenant?.id]);
  const [stores, setStores] = useState<StoreConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(false);
  const [provider, setProvider] = useState<StoreConnectorType>('rapidrms-api');
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState('');
  const [historyMonths, setHistoryMonths] = useState(12);
  const [sync, setSync] = useState<StoreSyncJob | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const [connected, jobs] = await Promise.all([listStores(auth), listStoreSyncs(auth)]); setStores(connected); setSync(jobs[0] || null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load stores'); }
    finally { setLoading(false); }
  }, [auth]);
  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy('create'); setError('');
    try {
      const definition = PROVIDERS[provider];
      const config: Record<string, unknown> = {}; const secrets: Record<string, string> = {};
      for (const field of definition.fields) {
        const value = (values[field.key] || '').trim();
        if (!value && !field.optional) throw new Error(`${field.label} is required`);
        if (!value) continue;
        if (field.secret) secrets[field.key] = value;
        else config[field.key] = field.key === 'port' ? Number(value) : value;
      }
      const connector = await createStore(auth, { type: provider, name: name.trim() || `${definition.name} connection`, config, secrets });
      await testStore(auth, connector.id);
      if (provider === 'rapidrms-api') await startStoreSync(auth, historyMonths);
      setDialog(false); setName(''); setValues({}); setVisibleSecrets({}); await load(); onConnect?.();
    } catch (e) { setError(e instanceof Error ? e.message : 'Connection failed'); }
    finally { setBusy(''); }
  }

  async function action(kind: 'test' | 'remove', id: string) {
    setBusy(`${kind}:${id}`); setError('');
    try { if (kind === 'test') await testStore(auth, id); else await removeStore(auth, id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : `${kind} failed`); }
    finally { setBusy(''); }
  }

  async function syncHistory() {
    setBusy('sync'); setError('');
    try { setSync(await startStoreSync(auth, historyMonths)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Historical sync failed to start'); }
    finally { setBusy(''); }
  }

  const healthy = stores.filter(store => store.status === 'connected').length;
  const startConnect = () => onConnect ? onConnect() : setDialog(true);
  return <div className="rsx-panel">
    <div className="rsx-panel__head"><div><div className="rsx-panel__eyebrow">Connections</div><p className="rsx-panel__lead">Connect each point of sale securely and keep its health visible.</p></div><button className="rsx-panel__cta" type="button" onClick={startConnect}>Connect POS</button></div>
    {error && <div className="rsx-note" role="alert"><div className="rsx-note__title">Connection issue</div><div className="rsx-note__body">{error}</div><button className="rsx-row__btn" onClick={() => void load()}>Retry</button></div>}
    {loading ? <div className="rsx2-empty"><div className="rsx2-empty__text">Loading stores…</div></div> : stores.length === 0 ? <div className="rsx2-empty"><div className="rsx2-empty__icon">◇</div><div className="rsx2-empty__title">No stores connected</div><div className="rsx2-empty__text">Connect RapidRMS or Verifone Commander to begin using live store data.</div><button className="rsx-panel__cta" onClick={startConnect}>Connect your POS</button></div> : <>
      <div className="rsx-stats"><div className="rsx-stat"><strong>{healthy}</strong><span>Healthy</span></div><div className="rsx-stat"><strong>{stores.length}</strong><span>Total connections</span></div><div className="rsx-stat"><strong>{stores.length - healthy}</strong><span>Needs attention</span></div></div>
      {stores.some(store => store.type === 'rapidrms-api' && store.status === 'connected') && <div className="rsx-note"><div className="rsx-note__title">Sales history</div><div className="rsx-note__body">{sync ? `${sync.status === 'completed' ? 'Synced' : sync.status === 'failed' ? 'Sync needs attention' : 'Syncing'} ${sync.from_date} through ${sync.to_date} · ${sync.progress}%${sync.last_error ? ` · ${sync.last_error}` : ''}` : 'Choose how much available RapidRMS history to import. The sync runs in resumable seven-day chunks.'}</div><div style={{ display: 'flex', gap: 8, marginTop: 10 }}><select aria-label="Sales history range" value={historyMonths} onChange={e => setHistoryMonths(Number(e.target.value))}><option value={3}>3 months</option><option value={6}>6 months</option><option value={12}>12 months</option><option value={24}>24 months</option></select><button className="rsx-row__btn" disabled={Boolean(busy) || sync?.status === 'queued' || sync?.status === 'running'} onClick={() => void syncHistory()}>{busy === 'sync' ? 'Starting…' : sync?.status === 'completed' ? 'Sync again' : 'Sync history'}</button></div></div>}
      <div className="rsx-rows">{stores.map(store => <div className="rsx-row" key={store.id}><div className="rsx-row__mark">{PROVIDERS[store.type]?.name.slice(0, 2).toUpperCase() || 'ST'}</div><div className="rsx-row__info"><div className="rsx-row__title">{store.name}</div><div className="rsx-row__sub">{PROVIDERS[store.type]?.name || store.type}{store.last_error ? ` · ${store.last_error}` : store.last_tested ? ` · Tested ${new Date(store.last_tested).toLocaleString()}` : ''}</div></div><span className={`rsx-pill rsx-pill--${store.status === 'connected' ? 'on' : store.status === 'error' ? 'off' : 'warn'}`}>{store.status === 'connected' ? 'Connected' : store.status === 'error' ? 'Error' : 'Pending'}</span><button className="rsx-row__btn" disabled={Boolean(busy)} onClick={() => void action('test', store.id)}>{busy === `test:${store.id}` ? 'Testing…' : 'Test'}</button><button className="rsx-row__btn" disabled={Boolean(busy)} onClick={() => void action('remove', store.id)}>{busy === `remove:${store.id}` ? 'Removing…' : 'Remove'}</button></div>)}</div>
    </>}
    {dialog && <div className="setup-modal-backdrop" onMouseDown={e => { if (e.currentTarget === e.target) setDialog(false); }}><form className="setup-modal" role="dialog" aria-modal="true" aria-label="Connect a store" onSubmit={submit}><div className="modal-title"><div><p className="setup-eyebrow">Secure connection</p><h2>Connect a store</h2></div><button className="modal-close" type="button" onClick={() => setDialog(false)} aria-label="Close">×</button></div><div className="provider-grid">{(Object.entries(PROVIDERS) as [StoreConnectorType, typeof PROVIDERS[StoreConnectorType]][]).map(([id, item]) => <button type="button" key={id} aria-pressed={provider === id} onClick={() => { setProvider(id); setValues({}); setVisibleSecrets({}); }}><span className="provider-mark">{item.name.slice(0, 2).toUpperCase()}</span><strong>{item.name}</strong><small>{item.description}</small></button>)}</div><div className="connection-form"><label>Connection name<input value={name} onChange={e => setName(e.target.value)} placeholder={`${PROVIDERS[provider].name} — Main store`} /></label>{PROVIDERS[provider].fields.map(field => {
      const isPassword = field.secret && field.key !== 'email';
      const inputId = `store-${provider}-${field.key}`;
      return <label key={field.key} htmlFor={inputId}>{field.label}{field.optional ? ' (optional)' : ''}<span style={{ display: 'flex', gap: 8 }}><input id={inputId} style={{ flex: 1 }} type={isPassword && !visibleSecrets[field.key] ? 'password' : field.key === 'email' ? 'email' : 'text'} value={values[field.key] || ''} autoComplete={field.key === 'email' ? 'username' : isPassword ? 'current-password' : 'off'} onChange={e => setValues(current => ({ ...current, [field.key]: e.target.value }))} />{isPassword && <button className="setup-secondary" type="button" aria-label={`${visibleSecrets[field.key] ? 'Hide' : 'Show'} ${field.label}`} aria-pressed={Boolean(visibleSecrets[field.key])} onClick={() => setVisibleSecrets(current => ({ ...current, [field.key]: !current[field.key] }))}>{visibleSecrets[field.key] ? 'Hide' : 'Show'}</button>}</span></label>;
    })}<p className="modal-copy">Credentials are encrypted server-side and are never returned to this browser.</p><div className="modal-actions"><button className="setup-secondary" type="button" onClick={() => setDialog(false)}>Cancel</button><button className="setup-primary" disabled={busy === 'create'}>{busy === 'create' ? 'Saving and testing…' : 'Save & test'}</button></div></div></form></div>}
  </div>;
}
