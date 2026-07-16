import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  SECTIONS, USER as DEMO_USER, CONVERSATIONS as DEMO_CONVERSATIONS, SUGGESTIONS,
  type SectionSpec, type SectionKey, type Row, type Card, type Status, type Conversation, type ChatMsg,
} from './shellData';

// ============================================================================
// Live vs demo data. THE GUARANTEE: demo content (persona, figures, sample
// catalogs) only renders when there is NO real session — i.e. the public
// /preview/app route. A logged-in (live) build fetches real data from the AROS
// API and shows empty states; it NEVER shows the demo persona or numbers, and
// never fabricates figures (defensive mapping → empty when a field is absent).
// ============================================================================

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

export function useDemo(): boolean {
  const { session } = useAuth();
  return !session;
}

function headers(session: any, tenant: any): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}),
  };
}
async function getJson(path: string, session: any, tenant: any): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: headers(session, tenant) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export interface Identity { name: string; workspace: string; initials: string; role: string; }
export function useIdentity(): Identity {
  const { user, tenant } = useAuth();
  const demo = useDemo();
  if (demo) return { name: DEMO_USER.name, workspace: DEMO_USER.workspace, initials: DEMO_USER.initials, role: DEMO_USER.role };
  const meta = (user as any)?.user_metadata || {};
  const name = meta.full_name || meta.name || user?.email?.split('@')[0] || 'You';
  const workspace = tenant?.name || 'Your workspace';
  const initials = String(name).split(/\s+/).map((s: string) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'U';
  return { name, workspace, initials, role: (tenant as any)?.role || 'Owner' };
}

const asStatus = (s: string): Status => (s === 'active' || s === 'connected' || s === 'healthy' ? 'on' : s === 'error' || s === 'down' ? 'off' : s ? 'warn' : 'off');

/** A section's content: demo spec (preview) or a live fetch + empty state. */
export function useSection(key: Exclude<SectionKey, 'chat'>): { spec: SectionSpec; loading: boolean } {
  const { session, tenant } = useAuth();
  const demo = useDemo();
  const base: SectionSpec = { eyebrow: SECTIONS[key].eyebrow, lead: SECTIONS[key].lead, primaryCta: SECTIONS[key].primaryCta };
  const [spec, setSpec] = useState<SectionSpec>(demo ? SECTIONS[key] : base);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (demo) { setSpec(SECTIONS[key]); setLoading(false); return; }
    let alive = true;
    const POS_TYPES = ['rapidrms-api', 'verifone-commander'];
    const setIf = (s: SectionSpec) => { if (alive) setSpec(s); };

    async function connectors(isStore: boolean) {
      setLoading(true);
      const data = await getJson('/api/connectors', session, tenant);
      const conns = (((data?.connectors) || []) as any[]).filter(c => isStore ? POS_TYPES.includes(c.type) : !POS_TYPES.includes(c.type));
      const rows: Row[] = conns.map(c => ({
        mark: String(c.name || c.type || '?').slice(0, 2).toUpperCase(),
        title: c.name || c.type,
        sub: c.last_error || (c.status === 'connected' ? 'Connected' : 'Needs attention'),
        status: asStatus(c.status), statusLabel: c.status || 'Unknown', action: 'Manage',
      }));
      setIf(rows.length ? { ...base, stats: [{ value: rows.filter(r => r.status === 'on').length, label: 'Connected' }, { value: rows.length, label: 'Total' }], rows } : base);
      if (alive) setLoading(false);
    }
    async function resources(kind: 'skill' | 'agent' | 'model' | 'app') {
      setLoading(true);
      const data = await getJson(`/api/resources/${kind}`, session, tenant);
      const items = (((data?.resources) || []) as any[]);
      if (kind === 'model' || kind === 'app') {
        const rows: Row[] = items.map(r => ({
          mark: String(r.name || r.provider || '?').slice(0, 2).toUpperCase(),
          title: r.name, sub: r.provider || r.config?.model || '',
          status: asStatus(r.status), statusLabel: r.status === 'active' ? 'Active' : 'Inactive',
          action: r.status === 'active' ? 'Configure' : 'Connect',
        }));
        setIf(rows.length ? { ...base, rows } : base);
      } else {
        const icon = kind === 'skill' ? '⚡' : '🤖';
        const cards: Card[] = items.map(r => ({
          icon, title: r.name, desc: (r.capabilities || []).join(', ') || r.provider || 'Configured capability.',
          status: asStatus(r.status), tag: r.status || 'inactive', cta: r.status === 'active' ? 'Configure' : 'Enable',
        }));
        setIf(cards.length ? { ...base, stats: [{ value: items.length, label: 'Available' }, { value: items.filter(i => asStatus(i.status) === 'on').length, label: 'Active' }], cards } : base);
      }
      if (alive) setLoading(false);
    }

    if (key === 'stores') connectors(true);
    else if (key === 'apps') resources('app');
    else if (key === 'models') resources('model');
    else if (key === 'skills') resources('skill');
    else if (key === 'agents') resources('agent');
    else setSpec(base); // permissions/health/team/billing/usage/settings — empty until wired
    return () => { alive = false; };
  }, [key, demo, session, tenant]); // eslint-disable-line react-hooks/exhaustive-deps

  return { spec, loading };
}

export interface HomeData {
  greetingSub: string;
  suggestions: string[];
  kpis: { value: string; label: string; delta: string; up?: boolean }[];
  approvals: { icon: string; title: string; by: string; when: string }[];
  activity: { icon: string; text: string; when: string }[];
}
const DEMO_HOME: HomeData = {
  greetingSub: `${DEMO_USER.workspace} Market · 5 stores live`,
  suggestions: SUGGESTIONS,
  kpis: [
    { value: '$18,240', label: 'Sales today', delta: '+4.2%', up: true },
    { value: '1,204', label: 'Transactions', delta: '+1.8%', up: true },
    { value: '4', label: 'Low-stock SKUs', delta: 'needs reorder' },
    { value: '2·1·1', label: 'Health (ok·deg·down)', delta: '1 needs attention' },
  ],
  approvals: [
    { icon: '🏷️', title: 'Raise carton prices 3% at all stores', by: 'Pricing Agent', when: '12m ago' },
    { icon: '📦', title: 'Reorder Marlboro Gold 100s · Harbor (qty 24)', by: 'Inventory Agent', when: '1h ago' },
  ],
  activity: [
    { icon: '📊', text: 'Pushed the morning sales digest — 5 stores, up 4.2% w/w.', when: '8:02 AM' },
    { icon: '🔎', text: 'Flagged 4 SKUs below reorder point across 3 stores.', when: '8:01 AM' },
    { icon: '✅', text: 'RapidRMS sync completed — 1,204 transactions imported.', when: '7:45 AM' },
  ],
};

function fmtMoney(n: any): string | null { const v = Number(n); return Number.isFinite(v) ? `$${v.toLocaleString()}` : null; }
function buildKpis(sum: any): HomeData['kpis'] {
  if (!sum || typeof sum !== 'object') return [];
  const out: HomeData['kpis'] = [];
  const sales = fmtMoney(sum.salesToday ?? sum.netSales ?? sum.sales?.today ?? sum.sales);
  if (sales) out.push({ value: sales, label: 'Sales today', delta: sum.salesDelta || '', up: Number(sum.changePercent ?? 0) >= 0 });
  const tx = sum.transactions ?? sum.txCount ?? sum.sales?.transactions;
  if (Number.isFinite(Number(tx))) out.push({ value: Number(tx).toLocaleString(), label: 'Transactions', delta: '' });
  const low = sum.lowStock ?? sum.lowStockCount;
  if (Number.isFinite(Number(low))) out.push({ value: String(low), label: 'Low-stock SKUs', delta: 'needs reorder' });
  return out;
}

export function useHomeData(): HomeData {
  const { session, tenant } = useAuth();
  const demo = useDemo();
  const id = useIdentity();
  const empty: HomeData = { greetingSub: `${id.workspace} · connect a register to see live numbers`, suggestions: SUGGESTIONS, kpis: [], approvals: [], activity: [] };
  const [data, setData] = useState<HomeData>(demo ? DEMO_HOME : empty);

  useEffect(() => {
    if (demo) { setData(DEMO_HOME); return; }
    let alive = true;
    (async () => {
      const [dash, sum] = await Promise.all([
        getJson('/api/dashboard', session, tenant),
        getJson('/api/store/summary', session, tenant),
      ]);
      if (!alive) return;
      const kpis = buildKpis(sum);
      const activity = (((dash?.recentActivity) || []) as any[]).slice(0, 4).map(a => ({ icon: '•', text: a.action || a.description || String(a), when: a.timestamp || '' }));
      const approvals = (((dash?.tasks) || []) as any[]).filter(t => (t.status || '') !== 'done').slice(0, 4).map(t => ({ icon: '📋', title: t.title || t.name || String(t), by: t.agent || 'Shre', when: t.timestamp || '' }));
      const live = Number(sum?.storesLive ?? sum?.stores);
      setData({
        greetingSub: Number.isFinite(live) ? `${id.workspace} · ${live} stores live` : empty.greetingSub,
        suggestions: SUGGESTIONS, kpis, approvals, activity,
      });
    })();
    return () => { alive = false; };
  }, [demo, session, tenant, id.workspace]); // eslint-disable-line react-hooks/exhaustive-deps

  return data;
}

export function useCanvasDemo(): boolean { return useDemo(); }

export function useConversations(): { list: Conversation[]; demo: boolean } {
  const demo = useDemo();
  // Live conversation history endpoint isn't available yet — empty until wired,
  // so no demo threads leak into a live build.
  return { list: demo ? DEMO_CONVERSATIONS : [], demo };
}

export type { SectionSpec, ChatMsg };
