import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { listIntelligence, setAgentPaused, type IntelligenceKind, type IntelligenceResource } from './api';

const COPY: Record<IntelligenceKind, { eyebrow: string; lead: string; empty: string }> = {
  skill: { eyebrow: 'Reusable capabilities', lead: 'Skills are versioned procedures agents can invoke within their approved scope.', empty: 'No skills are published to this workspace yet.' },
  agent: { eyebrow: 'Your AI team', lead: 'Agents coordinate goals and use only the skills and systems you approve.', empty: 'No agents are assigned to this workspace yet.' },
  model: { eyebrow: 'Model routing', lead: 'Available models discovered from the configured gateway and AROS catalog.', empty: 'No models are currently available from the configured gateway.' },
};

function StatePanel({ title, detail, action }: { title: string; detail: string; action?: () => void }) {
  return <div className="rsx2-empty" role="status"><div className="rsx2-empty__title">{title}</div><div className="rsx2-empty__text">{detail}</div>{action && <button className="rsx-panel__cta" type="button" onClick={action}>Try again</button>}</div>;
}

export function IntelligencePage({ kind }: { kind: IntelligenceKind }) {
  const { session, tenant } = useAuth();
  const [items, setItems] = useState<IntelligenceResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState('');
  const credentials = useMemo(() => ({ token: session?.access_token, tenantId: tenant?.id }), [session?.access_token, tenant?.id]);
  const copy = COPY[kind];

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setItems(await listIntelligence(kind, credentials)); }
    catch (cause) { setItems([]); setError(cause instanceof Error ? cause.message : 'The service could not be reached.'); }
    finally { setLoading(false); }
  }, [kind, credentials]);
  useEffect(() => { void load(); }, [load]);

  const visible = items.filter(item => `${item.name} ${item.description} ${item.provider || ''} ${item.capabilities.join(' ')} ${(item.skillsets || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const toggle = async (item: IntelligenceResource) => {
    const paused = item.status !== 'paused'; setBusyId(item.id); setError('');
    try { await setAgentPaused(item, paused, credentials); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The agent could not be updated.'); }
    finally { setBusyId(''); }
  };

  return <div className="rsx-panel">
    <div className="rsx-panel__head"><div><div className="rsx-panel__eyebrow">{copy.eyebrow}</div><p className="rsx-panel__lead">{copy.lead}</p></div></div>
    {!loading && items.length > 0 && <label className="rsx-form__field"><span className="rsx-form__label">Search</span><input className="rsx-form__input" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${kind}s`} /></label>}
    {error && <div className="rsx-note" role="alert"><div className="rsx-note__title">Needs attention</div><div className="rsx-note__body">{error}</div></div>}
    {loading ? <StatePanel title="Loading..." detail={`Checking the live ${kind} service.`} />
      : error && items.length === 0 ? <StatePanel title={`Could not load ${kind}s`} detail={error} action={() => void load()} />
      : items.length === 0 ? <StatePanel title={`No ${kind}s yet`} detail={copy.empty} action={() => void load()} />
      : visible.length === 0 ? <StatePanel title="No matches" detail="Try a different search term." />
      : <div className="rsx-rows">{visible.map(item => <div className="rsx-row" key={item.id}>
          <div className="rsx-row__mark">{item.name.slice(0, 2).toUpperCase()}</div>
          <div className="rsx-row__info"><div className="rsx-row__title">{item.name}</div><div className="rsx-row__sub">{item.description || item.provider || item.model || item.capabilities.join(' - ') || 'No description provided'}</div>{kind === 'agent' && item.skillsets && item.skillsets.length > 0 && <div className="rsx-row__sub">{item.skillsets.join(' - ')}</div>}</div>
          <span className={`rsx-pill rsx-pill--${['active', 'available', 'running'].includes(item.status) ? 'on' : item.status === 'paused' ? 'warn' : 'off'}`}>{item.status}</span>
          {kind === 'agent' && item.source === 'workspace' && <button className="rsx-row__btn" type="button" disabled={busyId === item.id} onClick={() => void toggle(item)}>{busyId === item.id ? 'Saving...' : item.status === 'paused' ? 'Resume' : 'Pause'}</button>}
        </div>)}</div>}
  </div>;
}

export const SkillsPage = () => <IntelligencePage kind="skill" />;
export const AgentsPage = () => <IntelligencePage kind="agent" />;
export const ModelsPage = () => <IntelligencePage kind="model" />;
