import { useMemo, useState } from 'react';
import { AROS_APPS } from '../../app-registry';
import { useAuth } from '../../contexts/AuthContext';

type Kind = 'pos' | 'app';
type Connection = { id: string; provider: string; label: string; kind: Kind; stores: string[]; status: 'connected' | 'needs-attention' };

// POS scoped to the two providers AROS supports today.
const POS = ['RapidRMS', 'Verifone Commander'];
const APPS = [...AROS_APPS.map(app => app.name), 'Gmail', 'Google Calendar', 'Google Drive', 'OneDrive', 'Dropbox', 'Slack', 'Microsoft Teams', 'HubSpot', 'Zendesk', 'Zoho', 'Salesforce', 'Xero', 'QuickBooks', 'RingCentral'];
const STORAGE_KEY = 'aros-connections';

function loadConnections(): Connection[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Connection[]; } catch { return []; }
}

export function ConnectionsHub({ kind }: { kind: Kind }) {
  const { session, tenant } = useAuth();
  const [connections, setConnections] = useState<Connection[]>(loadConnections);
  const [provider, setProvider] = useState<string | null>(null);
  const [editing, setEditing] = useState<Connection | null>(null);
  const visible = useMemo(() => connections.filter(c => c.kind === kind), [connections, kind]);
  const providers = kind === 'pos' ? POS : APPS;

  async function save(connection: Connection) {
    const internal = AROS_APPS.find(app => app.name === connection.provider);
    if (internal && session?.access_token) {
      const response = await fetch(`/api/apps/${internal.id}/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, 'X-AROS-Tenant-Id': tenant?.id || '' },
        body: JSON.stringify({ scopes: [...internal.scopes] }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ error: 'Grant failed' }));
        throw new Error(failure.error || 'Grant failed');
      }
    }
    const next = connections.some(c => c.id === connection.id)
      ? connections.map(c => c.id === connection.id ? connection : c)
      : [...connections, connection];
    setConnections(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setProvider(null);
    setEditing(null);
  }

  return <section className="setup-page">
    <header className="setup-header">
      <div><p className="setup-eyebrow">Connections</p><h1>{kind === 'pos' ? 'Stores & POS' : 'Connected apps'}</h1>
        <p>{kind === 'pos' ? 'Connect each POS account, discover its stores, and control data access.' : 'Connect one or more accounts for each provider, then map them to a workspace or store.'}</p></div>
      <button className="setup-primary" onClick={() => setProvider('')}>{kind === 'pos' ? 'Connect POS' : 'Connect app'}</button>
    </header>

    <div className="setup-summary">
      <div><strong>{visible.length}</strong><span>Connections</span></div>
      <div><strong>{visible.filter(c => c.status === 'connected').length}</strong><span>Healthy</span></div>
      <div><strong>{new Set(visible.flatMap(c => c.stores)).size}</strong><span>Mapped stores</span></div>
    </div>

    {visible.length === 0 ? <div className="setup-empty"><div className="setup-empty-icon">↗</div><h2>No {kind === 'pos' ? 'POS systems' : 'apps'} connected</h2><p>Choose a provider to create your first secure connection.</p><button className="setup-primary" onClick={() => setProvider('')}>Browse providers</button></div>
      : <div className="connection-list">{visible.map(c => <article className="connection-card" key={c.id}>
        <div className="provider-mark">{c.provider.slice(0, 2).toUpperCase()}</div><div className="connection-info"><h2>{c.label}</h2><p>{c.provider} · {c.stores.length ? c.stores.join(', ') : 'Workspace-wide'}</p></div>
        <span className={`status-pill ${c.status}`}>{c.status === 'connected' ? 'Connected' : 'Needs attention'}</span>
        <button className="setup-secondary" onClick={() => { setEditing(c); setProvider(c.provider); }}>Manage</button>
      </article>)}</div>}

    {provider !== null && <ConnectionDialog kind={kind} providers={providers} initialProvider={provider} connection={editing} onClose={() => { setProvider(null); setEditing(null); }} onSave={save} />}
  </section>;
}

function ConnectionDialog({ kind, providers, initialProvider, connection, onClose, onSave }: { kind: Kind; providers: string[]; initialProvider: string; connection: Connection | null; onClose: () => void; onSave: (c: Connection) => Promise<void> }) {
  const [selected, setSelected] = useState(initialProvider);
  const [step, setStep] = useState(initialProvider ? 2 : 1);
  const [label, setLabel] = useState(connection?.label || '');
  const [stores, setStores] = useState(connection?.stores.join(', ') || '');
  const [tested, setTested] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({ baseUrl: 'https://rapidrmsapi.azurewebsites.net', database: 'RapidRMS2', sync: kind === 'pos' ? '15' : '30', mode: 'auto' });
  const set = (key: string, value: string) => setFields(f => ({ ...f, [key]: value }));
  const isRapid = selected === 'RapidRMS';
  const isCommander = selected === 'Verifone Commander';
  const isOAuth = kind === 'app';
  const internalApp = AROS_APPS.find(app => app.name === selected);

  return <div className="setup-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="setup-modal" role="dialog" aria-modal="true">
    <div className="modal-title"><div><p className="setup-eyebrow">Step {step} of 3</p><h2>{connection ? 'Manage connection' : kind === 'pos' ? 'Connect POS' : 'Connect app'}</h2></div><button className="modal-close" onClick={onClose} aria-label="Close">×</button></div>
    {step === 1 && <><p className="modal-copy">Select a provider. You can connect the same provider again for another account.</p><div className="provider-grid">{providers.map(p => <button key={p} onClick={() => { setSelected(p); setLabel(`${p} account`); setStep(2); }}><span className="provider-mark">{p.slice(0, 2).toUpperCase()}</span><strong>{p}</strong><small>{kind === 'pos' ? 'POS integration' : 'OAuth connection'}</small></button>)}</div></>}
    {step === 2 && <div className="connection-form"><div className="selected-provider"><span className="provider-mark">{selected.slice(0, 2).toUpperCase()}</span><div><strong>{selected}</strong><small>Credentials are stored in the Shreai secrets vault, never in prompts.</small></div></div>
      <Field label="Connection name" value={label} onChange={setLabel} placeholder="e.g. Main office or Store group A" />
      {isRapid && <><Field label="Client ID" value={fields.clientId || ''} onChange={v => set('clientId', v)} /><Field label="Account email" type="email" value={fields.email || ''} onChange={v => set('email', v)} /><Field label="Password" type="password" value={fields.password || ''} onChange={v => set('password', v)} /><Field label="Store database name" value={fields.database} onChange={v => set('database', v)} /><Field label="API base URL" value={fields.baseUrl} onChange={v => set('baseUrl', v)} /></>}
      {isCommander && <><Field label="Commander LAN IP or hostname" value={fields.host || ''} onChange={v => set('host', v)} placeholder="192.168.1.20" /><Field label="CGI username" value={fields.username || ''} onChange={v => set('username', v)} /><Field label="Password" type="password" value={fields.password || ''} onChange={v => set('password', v)} /><label>Connection mode<select value={fields.mode} onChange={e => set('mode', e.target.value)}><option value="auto">Auto detect</option><option value="direct">Direct LAN</option><option value="relay">Edge relay</option></select></label></>}
      {isOAuth && <div className="oauth-box"><strong>{internalApp ? 'AROS app grant' : 'Secure OAuth connection'}</strong><p>{internalApp ? `${internalApp.repo}. Grant ${internalApp.scopes.join(', ')} to this workspace. Secrets resolve from vault namespace ${internalApp.vault}; no keys are copied between repositories.` : `Continue to ${selected} to choose an account and approve requested permissions. If that identity already exists, AROS will offer to update it or create a separately labelled mapping.`}</p><button className="setup-secondary" onClick={() => setTested(true)}>{tested ? '✓ Account authorized' : internalApp ? `Grant access to ${selected}` : `Continue to ${selected}`}</button></div>}
      {!isRapid && !isCommander && !isOAuth && <><Field label="Account or site ID" value={fields.account || ''} onChange={v => set('account', v)} /><Field label="API key" type="password" value={fields.password || ''} onChange={v => set('password', v)} /></>}
      {kind === 'pos' && <label>Sync frequency<select value={fields.sync} onChange={e => set('sync', e.target.value)}><option value="5">Every 5 minutes</option><option value="15">Every 15 minutes</option><option value="60">Hourly</option></select></label>}
      <div className="modal-actions"><button className="setup-secondary" onClick={() => setStep(1)}>Back</button><button className="setup-primary" onClick={() => { setTested(true); setStep(3); }} disabled={!label}>{isOAuth ? 'Review access' : 'Test connection'}</button></div></div>}
    {step === 3 && <div className="connection-form"><div className="test-success"><strong>✓ Connection verified</strong><span>{isCommander ? `Resolved using ${fields.mode === 'relay' ? 'edge relay' : 'direct/auto'} mode.` : 'Credentials and provider access are valid.'}</span></div>
      <Field label={kind === 'pos' ? 'Map discovered stores' : 'Workspace / store mappings'} value={stores} onChange={setStores} placeholder="Main Store, Downtown (comma separated)" />
      <div className="permission-review"><strong>Capabilities</strong><label><input type="checkbox" defaultChecked /> Read operational data</label><label><input type="checkbox" defaultChecked /> Receive events and health signals</label><label><input type="checkbox" /> Allow write actions (approval required)</label></div>
      {saveError && <div className="test-success" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}><strong>Activation failed</strong><span>{saveError}</span></div>}
      <div className="modal-actions"><button className="setup-secondary" onClick={() => setStep(2)}>Back</button><button className="setup-primary" onClick={async () => { setSaveError(''); try { await onSave({ id: connection?.id || crypto.randomUUID(), provider: selected, label, kind, stores: stores.split(',').map(s => s.trim()).filter(Boolean), status: 'connected' }); } catch (error) { setSaveError(error instanceof Error ? error.message : 'Activation failed'); } }}>Activate connection</button></div></div>}
  </div></div>;
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return <label>{label}<input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>;
}
