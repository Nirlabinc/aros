import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { createAppLaunch, disableApp, grantApp, listApps, listStores, type AppGrant, type PlatformApp, type StoreConnector } from './api';

export function AppsPage() {
  const { session, tenant } = useAuth();
  const auth = useMemo(() => ({ accessToken: session?.access_token, tenantId: tenant?.id }), [session?.access_token, tenant?.id]);
  const [apps, setApps] = useState<PlatformApp[]>([]);
  const [grants, setGrants] = useState<AppGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [setupApp, setSetupApp] = useState<PlatformApp | null>(null);
  const [stores, setStores] = useState<StoreConnector[]>([]);
  const [storeIds, setStoreIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await listApps(auth); setApps(data.apps); setGrants(data.grants); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load apps'); }
    finally { setLoading(false); }
  }, [auth]);
  useEffect(() => { void load(); }, [load]);

  const active = new Set(grants.filter(grant => grant.status === 'active').map(grant => grant.app_key));
  const visible = apps.filter(app => `${app.name} ${app.description || ''}`.toLowerCase().includes(query.toLowerCase()));

  async function beginSetup(app: PlatformApp) {
    setError('');
    try {
      const connected = (await listStores(auth)).filter(store => store.status === 'connected');
      const grant = grants.find(item => item.app_key === app.id);
      setStores(connected);
      setStoreIds(grant?.service_config?.storeIds || connected.map(store => store.id));
      setSetupApp(app);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load store scope'); }
  }

  async function saveSetup() {
    if (!setupApp) return;
    setBusy(setupApp.id); setError('');
    try { await grantApp(auth, setupApp, storeIds); setSetupApp(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'App activation failed'); }
    finally { setBusy(''); }
  }

  async function toggle(app: PlatformApp) {
    if (!active.has(app.id)) {
      if (app.id === 'storepulse') return beginSetup(app);
      setBusy(app.id); setError('');
      try { await grantApp(auth, app); await load(); }
      catch (e) { setError(e instanceof Error ? e.message : 'App update failed'); }
      finally { setBusy(''); }
      return;
    }
    setBusy(app.id); setError('');
    try { await disableApp(auth, app.id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'App update failed'); }
    finally { setBusy(''); }
  }

  async function openApp(app: PlatformApp) {
    if (app.id !== 'storepulse') { if (app.url) window.location.assign(app.url); return; }
    setBusy(`open:${app.id}`); setError('');
    try { window.location.assign(await createAppLaunch(auth, app.id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'App launch failed'); setBusy(''); }
  }

  return <div className="rsx-panel">
    <div className="rsx-panel__head"><div><div className="rsx-panel__eyebrow">Workspace apps</div><p className="rsx-panel__lead">Grant only the capabilities each workspace needs, then open connected apps directly.</p></div></div>
    {error && <div className="rsx-note" role="alert"><div className="rsx-note__title">Apps unavailable</div><div className="rsx-note__body">{error}</div><button className="rsx-row__btn" onClick={() => void load()}>Retry</button></div>}
    {loading ? <div className="rsx2-empty"><div className="rsx2-empty__text">Loading apps…</div></div> : apps.length === 0 ? <div className="rsx2-empty"><div className="rsx2-empty__icon">◇</div><div className="rsx2-empty__title">No apps published</div><div className="rsx2-empty__text">The platform catalog returned no apps for this workspace.</div></div> : <>
      <div className="rsx-stats"><div className="rsx-stat"><strong>{active.size}</strong><span>Active</span></div><div className="rsx-stat"><strong>{apps.length}</strong><span>Available</span></div></div>
      <div className="rsx-form"><label className="rsx-form__field"><span className="rsx-form__label">Find an app</span><input className="rsx-form__input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search apps" /></label></div>
      {visible.length === 0 ? <div className="rsx2-empty"><div className="rsx2-empty__title">No matching apps</div><div className="rsx2-empty__text">Try another name or keyword.</div></div> : <div className="rsx-cards">{visible.map(app => {
        const enabled = active.has(app.id); const unavailable = app.status !== 'active';
        const mapped = grants.find(item => item.app_key === app.id)?.service_config?.storeIds?.length || 0;
        return <article className="rsx-card" key={app.id}><div className="rsx-card__top"><div className="rsx-card__icon">{app.icon || app.name.slice(0, 2).toUpperCase()}</div><div className="rsx-card__title">{app.name}</div></div><div className="rsx-card__desc">{app.description || 'No description provided by the app catalog.'}</div><div className="rsx-card__desc">{enabled && app.id === 'storepulse' ? (mapped ? `${mapped} connected store${mapped === 1 ? '' : 's'} mapped · Ready for store intelligence` : 'Active · Connect a store to begin syncing data') : (app.required_scopes || []).length ? `Access: ${(app.required_scopes || []).join(', ')}` : 'No additional scopes requested.'}</div><div className="rsx-card__foot"><span className={`rsx-badge rsx-badge--${enabled ? 'on' : unavailable ? 'warn' : 'off'}`}>{enabled ? 'Active' : unavailable ? 'Setup required' : 'Available'}</span>{enabled && app.url && <button className="rsx-card__btn" disabled={Boolean(busy)} onClick={() => void openApp(app)}>{busy === `open:${app.id}` ? 'Opening…' : 'Open'}</button>}{enabled && app.id === 'storepulse' && <button className="rsx-card__btn" disabled={Boolean(busy)} onClick={() => void beginSetup(app)}>Manage</button>}<button className="rsx-card__btn" disabled={Boolean(busy) || unavailable} onClick={() => void toggle(app)}>{busy === app.id ? 'Updating…' : enabled ? 'Disable' : unavailable ? 'Not ready' : 'Enable'}</button></div></article>;
      })}</div>}
    </>}
    {setupApp && <div className="setup-modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) setSetupApp(null); }}><div className="setup-modal" role="dialog" aria-modal="true" aria-label="Set up StorePulse"><div className="modal-title"><div><p className="setup-eyebrow">StorePulse setup</p><h2>Choose data access</h2></div><button className="modal-close" type="button" onClick={() => setSetupApp(null)} aria-label="Close">×</button></div><div className="connection-form"><div className="rsx-note"><div className="rsx-note__title">Requested capabilities</div><div className="rsx-note__body">Read stores and POS data for dashboards, health monitoring, and approved agent questions. StorePulse does not receive write access.</div></div>{stores.length ? <fieldset><legend>Connected stores</legend>{stores.map(store => <label key={store.id}><input type="checkbox" checked={storeIds.includes(store.id)} onChange={event => setStoreIds(current => event.target.checked ? [...current, store.id] : current.filter(id => id !== store.id))} /> {store.name}</label>)}</fieldset> : <div className="rsx-note"><div className="rsx-note__title">No healthy stores found</div><div className="rsx-note__body">You can activate StorePulse now, then connect a POS from Stores before live data can sync.</div></div>}<div className="test-success"><strong>What happens next</strong><span>AROS registers StorePulse for this workspace, exposes it in Connection Health, and unlocks its Open action. Live insights begin when at least one healthy store is mapped.</span></div></div><div className="modal-actions"><button className="setup-secondary" type="button" onClick={() => setSetupApp(null)}>Cancel</button><button className="setup-primary" type="button" disabled={Boolean(busy)} onClick={() => void saveSetup()}>{busy ? 'Activating…' : active.has(setupApp.id) ? 'Save store access' : 'Activate StorePulse'}</button></div></div></div>}
  </div>;
}
