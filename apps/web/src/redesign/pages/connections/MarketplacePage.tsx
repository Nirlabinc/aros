import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { disableApp, grantApp, listApps, type AppGrant, type PlatformApp } from './api';

type Tab = 'apps' | 'connectors' | 'plugins' | 'agents';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'apps', label: 'Apps' }, { id: 'connectors', label: 'Connectors' },
  { id: 'plugins', label: 'Plugins' }, { id: 'agents', label: 'Agents' },
];
const CONNECTORS = [
  ['gmail','Gmail','Email search, drafts, sends, and calendar workflows'], ['google-drive','Google Drive','Files, folders, documents, and grounded retrieval'],
  ['hubspot','HubSpot','Contacts, companies, deals, and CRM workflows'], ['mailchimp','Mailchimp','Audiences, campaigns, and reporting'],
  ['sendgrid','SendGrid','Transactional email delivery'], ['twilio','Twilio','SMS, WhatsApp, and calling'],
  ['slack','Slack','Messages, alerts, approvals, and workflows'], ['microsoft-teams','Microsoft Teams','Messages, meetings, and collaboration'],
  ['google-calendar','Google Calendar','Events, availability, and scheduling'], ['zoom','Zoom','Meetings, recordings, and scheduling'],
] as const;
const PLUGINS = [
  ['mcp-client','Universal MCP Client','Connect approved MCP servers and expose their tools through policy gates'],
  ['retail-toolkit','Retail Operations Toolkit','Store-aware tools for inventory, sales, pricing, and approvals'],
] as const;
const AGENTS = [
  ['ellie','Ellie','Store concierge and specialist router'], ['ana','Ana','Inventory intelligence'],
  ['sammy','Sammy','Revenue and P&L intelligence'], ['victor','Victor','Revenue integrity and void analysis'],
  ['larry','Larry','Labor and scheduling intelligence'], ['rita','Rita','Reputation and guest voice'],
] as const;

export function MarketplacePage() {
  const { session, tenant } = useAuth();
  const auth = useMemo(() => ({ accessToken: session?.access_token, tenantId: tenant?.id }), [session?.access_token, tenant?.id]);
  const [tab, setTab] = useState<Tab>('apps'); const [apps, setApps] = useState<PlatformApp[]>([]); const [grants, setGrants] = useState<AppGrant[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busy, setBusy] = useState(''); const [query, setQuery] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { const data = await listApps(auth); setApps(data.apps); setGrants(data.grants); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load Marketplace'); } finally { setLoading(false); } }, [auth]);
  useEffect(() => { void load(); }, [load]);
  const active = new Set(grants.filter(g => g.status === 'active').map(g => g.app_key));
  async function toggle(app: PlatformApp) { setBusy(app.id); setError(''); try { if (active.has(app.id)) await disableApp(auth, app.id); else await grantApp(auth, app); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'App update failed'); } finally { setBusy(''); } }
  const q = query.toLowerCase();
  const catalog = tab === 'connectors' ? CONNECTORS : tab === 'plugins' ? PLUGINS : AGENTS;
  return <div className="rsx-panel">
    <div className="rsx-panel__head"><div><div className="rsx-panel__eyebrow">Marketplace</div><p className="rsx-panel__lead">Discover AROS apps, connect business systems, and add approved plugins and specialist agents.</p></div></div>
    <div className="rsx2-tabs" role="tablist">{TABS.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={`rsx2-tab ${tab === item.id ? 'is-on' : ''}`} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    <div className="rsx-form"><label className="rsx-form__field"><span className="rsx-form__label">Search Marketplace</span><input className="rsx-form__input" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${tab}`} /></label></div>
    {error && <div className="rsx-note" role="alert"><div className="rsx-note__title">Marketplace unavailable</div><div className="rsx-note__body">{error}</div><button className="rsx-row__btn" onClick={() => void load()}>Retry</button></div>}
    {tab === 'apps' ? loading ? <Empty text="Loading apps…" /> : <div className="rsx-cards">{apps.filter(app => `${app.name} ${app.description || ''}`.toLowerCase().includes(q)).map(app => { const enabled = active.has(app.id); const unavailable = app.status === 'planned'; return <article className="rsx-card" key={app.id}><div className="rsx-card__top"><div className="rsx-card__icon">{app.icon || app.name.slice(0,2).toUpperCase()}</div><div className="rsx-card__title">{app.name}</div></div><div className="rsx-card__desc">{app.description || 'AROS application'}</div><div className="rsx-card__desc">{(app.required_scopes || []).length ? `Access: ${app.required_scopes!.join(', ')}` : 'No additional scopes requested.'}</div><div className="rsx-card__foot"><span className={`rsx-badge rsx-badge--${enabled ? 'on' : unavailable ? 'warn' : 'off'}`}>{enabled ? 'Active' : unavailable ? 'Planned' : 'Available'}</span>{enabled && app.url && <a className="rsx-card__btn" href={app.url} target="_blank" rel="noreferrer">Open dashboard</a>}<button className="rsx-card__btn" disabled={Boolean(busy) || unavailable} onClick={() => void toggle(app)}>{busy === app.id ? 'Updating…' : enabled ? 'Disable' : unavailable ? 'Coming soon' : 'Activate'}</button></div></article>; })}</div>
      : <div className="rsx-cards">{catalog.filter(item => `${item[1]} ${item[2]}`.toLowerCase().includes(q)).map(item => <article className="rsx-card" key={item[0]}><div className="rsx-card__top"><div className="rsx-card__icon">{item[1].slice(0,2).toUpperCase()}</div><div className="rsx-card__title">{item[1]}</div></div><div className="rsx-card__desc">{item[2]}</div><div className="rsx-card__foot"><span className="rsx-badge rsx-badge--warn">Catalog</span><button className="rsx-card__btn" disabled title="Tenant-scoped authorization bridge required">Coming soon</button></div></article>)}</div>}
  </div>;
}

function Empty({ text }: { text: string }) { return <div className="rsx2-empty"><div className="rsx2-empty__text">{text}</div></div>; }
