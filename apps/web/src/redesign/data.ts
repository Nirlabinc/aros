import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  SECTIONS, USER as DEMO_USER, CONVERSATIONS as DEMO_CONVERSATIONS, SUGGESTIONS,
  type SectionSpec, type SectionKey, type Row, type Card, type Status, type Conversation, type ChatMsg,
} from './shellData';
import { loadChatHistory, subscribeChatHistory } from './chatHistory';

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

export function useConnectionSummary(): { total: number; healthy: number; loading: boolean } {
  const { session, tenant } = useAuth();
  const demo = useDemo();
  const [summary, setSummary] = useState({ total: 0, healthy: 0, loading: !demo });
  useEffect(() => {
    if (demo) { setSummary({ total: 5, healthy: 5, loading: false }); return; }
    let alive = true;
    setSummary(current => ({ ...current, loading: true }));
    getJson('/api/connectors', session, tenant).then(data => {
      if (!alive) return;
      const connectors = Array.isArray(data?.connectors) ? data.connectors : [];
      setSummary({ total: connectors.length, healthy: connectors.filter((item: any) => item?.status === 'connected' || item?.status === 'healthy').length, loading: false });
    });
    return () => { alive = false; };
  }, [demo, session, tenant]);
  return summary;
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

    async function health() {
      setLoading(true);
      const data = await getJson('/api/connectors', session, tenant);
      const conns = ((data?.connectors) || []) as any[];
      const healthy = conns.filter(c => c.status === 'connected').length;
      const down = conns.filter(c => c.status === 'error').length;
      const degraded = conns.length - healthy - down;
      const rows: Row[] = conns.map(c => ({
        mark: String(c.name || c.type || '?').slice(0, 2).toUpperCase(), title: c.name || c.type,
        sub: c.last_error || c.last_tested || '', status: asStatus(c.status),
        statusLabel: c.status === 'connected' ? 'Healthy' : c.status === 'error' ? 'Down' : 'Degraded', action: 'Details',
      }));
      setIf(conns.length ? { ...base, stats: [{ value: healthy, label: 'Healthy' }, { value: degraded, label: 'Degraded' }, { value: down, label: 'Down' }], rows } : base);
      if (alive) setLoading(false);
    }
    async function billingLike(which: 'billing' | 'usage') {
      setLoading(true);
      const q = tenant?.id ? `?tenantId=${encodeURIComponent(tenant.id)}` : '';
      const data = await getJson(`/api/billing/status${q}`, session, tenant);
      const sub = (data?.subscription) || data || {};
      if (which === 'billing') {
        const plan = data?.plan || data?.license_tier;
        setIf(plan ? { ...base, stats: [{ value: String(plan), label: 'Plan' }, { value: String(data?.billing_status || 'active'), label: 'Status' }] } : base);
      } else {
        const stats = [];
        if (Number.isFinite(Number(sub.totalRequests))) stats.push({ value: Number(sub.totalRequests).toLocaleString(), label: 'Requests' });
        if (Number.isFinite(Number(sub.totalCostUsd))) stats.push({ value: `$${Number(sub.totalCostUsd).toFixed(2)}`, label: 'Spend' });
        setIf(stats.length ? { ...base, stats } : base);
      }
      if (alive) setLoading(false);
    }
    function team() {
      const email = session?.user?.email || (session as any)?.user?.email || '';
      const name = (session?.user?.user_metadata?.full_name) || email.split('@')[0] || 'You';
      const initials = String(name).split(/\s+/).map((s: string) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'U';
      setIf({ ...base, stats: [{ value: 1, label: 'Members' }], rows: [{ mark: initials, title: name, sub: `${email} · Owner`, status: 'on', statusLabel: 'Active', action: 'Manage' }] });
    }
    function settings() {
      setIf({ ...base, form: [{ label: 'Workspace name', value: tenant?.name || '', type: 'text' }, ...(SECTIONS.settings.form || []).slice(1)], note: SECTIONS.settings.note });
    }

    if (key === 'stores') connectors(true);
    else if (key === 'apps') resources('app');
    else if (key === 'models') resources('model');
    else if (key === 'skills') resources('skill');
    else if (key === 'agents') resources('agent');
    else if (key === 'health') health();
    else if (key === 'billing') billingLike('billing');
    else if (key === 'usage') billingLike('usage');
    else if (key === 'team') team();
    else if (key === 'settings') settings();
    else if (key === 'permissions') setSpec(SECTIONS.permissions); // role scopes are product policy, not tenant data
    else setSpec(base);
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
  /**
   * Honest data state: no connector yet / connector whose numbers are on the
   * way (summary-capable, none fetched yet or a transient failure) / connector
   * whose type can't feed the dashboard (e.g. Verifone, Azure — no summary
   * mapper yet) / live numbers rendering.
   */
  dataState: 'none' | 'syncing' | 'connected' | 'live';
}
const DEMO_HOME: HomeData = {
  dataState: 'live',
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
// Maps the server's StoreSummary shape (GET /api/store/summary → { connected,
// summary: { todaySales, lowStock, source } }, see connectors/data-service.ts).
function buildKpis(summary: any): HomeData['kpis'] {
  if (!summary || typeof summary !== 'object') return [];
  const out: HomeData['kpis'] = [];
  const today = summary.todaySales ?? {};
  const sales = today.revenue == null ? null : fmtMoney(today.revenue);
  if (sales) {
    const pct = typeof today.changePercent === 'number' ? today.changePercent : null;
    out.push({
      value: sales,
      label: 'Sales today',
      delta: pct !== null ? `${pct > 0 ? '+' : ''}${pct}% vs last week` : 'collecting history',
      up: pct !== null ? pct > 0 : undefined,
    });
  }
  const tx = today.transactions;
  if (Number.isFinite(Number(tx))) out.push({ value: Number(tx).toLocaleString(), label: 'Transactions', delta: '' });
  const low = summary.lowStock?.count;
  if (Number.isFinite(Number(low))) out.push({ value: String(low), label: 'Low-stock SKUs', delta: Number(low) > 0 ? 'needs reorder' : 'all stocked' });
  return out;
}

export function useHomeData(): HomeData {
  const { session, tenant } = useAuth();
  const demo = useDemo();
  const id = useIdentity();
  const empty: HomeData = { greetingSub: `${id.workspace} · connect a register to see live numbers`, suggestions: SUGGESTIONS, kpis: [], approvals: [], activity: [], dataState: 'none' };
  const [data, setData] = useState<HomeData>(demo ? DEMO_HOME : empty);

  useEffect(() => {
    if (demo) { setData(DEMO_HOME); return; }
    let alive = true;
    (async () => {
      const [dash, res] = await Promise.all([
        getJson('/api/dashboard', session, tenant),
        getJson('/api/store/summary', session, tenant),
      ]);
      if (!alive) return;
      // Server contract (src/server.ts handleStoreSummary, end-user path):
      // { connected, summary } plus — only when summary is null —
      // { hasConnector, summaryCapable }. `connected` strictly means live data
      // was fetched; the extra fields distinguish "no connector" from
      // "connector saved, numbers pending (or never coming for its type)".
      const summary = res?.summary ?? null;
      const kpis = buildKpis(summary);
      const dataState: HomeData['dataState'] = summary
        ? 'live'
        : res?.summaryCapable
          ? 'syncing'
          : res?.hasConnector
            ? 'connected'
            : 'none';
      const greetingSub = dataState === 'live'
        ? `${id.workspace} · live from ${summary?.source?.name || 'your store'}`
        : dataState === 'syncing'
          ? `${id.workspace} · store connected — fetching your latest numbers`
          : dataState === 'connected'
            ? `${id.workspace} · store connected`
            : empty.greetingSub;
      const activity = (((dash?.recentActivity) || []) as any[]).slice(0, 4).map(a => ({ icon: '•', text: a.action || a.description || String(a), when: a.timestamp || '' }));
      const approvals = (((dash?.tasks) || []) as any[]).filter(t => (t.status || '') !== 'done').slice(0, 4).map(t => ({ icon: '📋', title: t.title || t.name || String(t), by: t.agent || 'Shre', when: t.timestamp || '' }));
      setData({ greetingSub, suggestions: SUGGESTIONS, kpis, approvals, activity, dataState });
    })();
    return () => { alive = false; };
  }, [demo, session, tenant, id.workspace]); // eslint-disable-line react-hooks/exhaustive-deps

  return data;
}

// ── Weekly Owner Brief (GET /api/digest → shre-rapidrms owner-digest row) ──
// Same guarantee as the rest of this file: demo brief only on the public
// preview; a live build renders only what the API returns, and any missing or
// malformed field maps to "render nothing" — never a fabricated number.

export interface BriefTile { value: string; label: string; delta: string; up?: boolean; down?: boolean }
export interface OwnerBrief {
  /** Human period-end label ("Jul 13"), or '' when unknown. */
  periodEnd: string;
  /** Scorecard tiles — same visual shape as the Home KPI tiles. */
  tiles: BriefTile[];
  /** The single "do this today" recommendation (may be ''). */
  action: string;
  reason: string;
  leakCount: number;
  reorderCount: number;
  reorderCost: number | null;
  deadStockCapital: number | null;
}

const DEMO_BRIEF: OwnerBrief = {
  periodEnd: 'this week',
  tiles: [
    { value: '$41,320', label: 'Revenue (7d)', delta: '+4.2% vs last week', up: true },
    { value: '2,860', label: 'Transactions (7d)', delta: '+1.8% vs last week', up: true },
    { value: '$14.45', label: 'Avg ticket', delta: '' },
    { value: '$3.12', label: 'Est. profit / basket', delta: '-2.1% vs last week', down: true },
  ],
  action: 'Fix pricing on 3 items selling below cost',
  reason: 'Three top-velocity SKUs are priced under invoice cost — every sale loses money.',
  leakCount: 3, reorderCount: 19, reorderCost: 1240, deadStockCapital: 5180,
};

function briefMoney(n: any, cents = false): string | null {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return `$${v.toLocaleString(undefined, cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })}`;
}
function briefDelta(n: any): { delta: string; up?: boolean; down?: boolean } {
  const v = Number(n);
  if (!Number.isFinite(v)) return { delta: 'collecting history' };
  return { delta: `${v > 0 ? '+' : ''}${v}% vs last week`, up: v > 0, down: v < 0 };
}
function briefDay(iso: any): string {
  try {
    const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch { return ''; }
}

/** Server contract (src/server.ts handleOwnerDigest): always 200 with a
 * `digest` key — the owner-digest row's JSON, or null (no POS mapped / no
 * digest yet / upstream unavailable). Null in → null out → no card. */
export function buildBrief(raw: any): OwnerBrief | null {
  const digest = raw?.digest;
  const score = digest?.scorecard;
  if (!score || typeof score !== 'object') return null;

  const tiles: BriefTile[] = [];
  const revenue = briefMoney(score.revenue_7d);
  if (revenue) tiles.push({ value: revenue, label: 'Revenue (7d)', ...briefDelta(score.revenue_wow_pct) });
  const tx = Number(score.transactions_7d);
  if (Number.isFinite(tx)) tiles.push({ value: tx.toLocaleString(), label: 'Transactions (7d)', ...briefDelta(score.transactions_wow_pct) });
  const ticket = briefMoney(score.avg_ticket_7d, true);
  if (ticket) tiles.push({ value: ticket, label: 'Avg ticket', delta: '' });
  const basket = briefMoney(score.est_profit_per_basket, true);
  if (basket) {
    const coverage = Number(score.cost_coverage_pct);
    tiles.push({
      value: basket,
      label: Number.isFinite(coverage) ? `Est. profit / basket (${Math.round(coverage)}% cost data)` : 'Est. profit / basket',
      ...briefDelta(score.est_profit_per_basket_wow_pct),
    });
  }
  if (tiles.length === 0) return null; // a digest with no numbers is not worth a card

  const reorderCandidates = Number(digest?.reorder_total_candidates);
  const reorderCost = Number(digest?.reorder_total_cost);
  const deadStock = Number(digest?.dead_stock_total_capital);
  return {
    periodEnd: briefDay(raw?.period_end ?? digest?.period?.end),
    tiles,
    action: typeof digest?.recommendation?.action === 'string' ? digest.recommendation.action : '',
    reason: typeof digest?.recommendation?.reason === 'string' ? digest.recommendation.reason : '',
    leakCount: Array.isArray(digest?.margin_leaks) ? digest.margin_leaks.length : 0,
    reorderCount: Number.isFinite(reorderCandidates) ? reorderCandidates : (Array.isArray(digest?.reorder) ? digest.reorder.length : 0),
    reorderCost: Number.isFinite(reorderCost) ? reorderCost : null,
    deadStockCapital: Number.isFinite(deadStock) ? deadStock : null,
  };
}

export function useOwnerDigest(): OwnerBrief | null {
  const { session, tenant } = useAuth();
  const demo = useDemo();
  const [brief, setBrief] = useState<OwnerBrief | null>(demo ? DEMO_BRIEF : null);
  useEffect(() => {
    if (demo) { setBrief(DEMO_BRIEF); return; }
    let alive = true;
    // getJson never throws (network/parse errors → null → no card).
    getJson('/api/digest', session, tenant).then(data => {
      if (!alive) return;
      try { setBrief(buildBrief(data)); } catch { setBrief(null); }
    });
    return () => { alive = false; };
  }, [demo, session, tenant]);
  return brief;
}

export function useCanvasDemo(): boolean { return useDemo(); }

export function useConversations(): { list: Conversation[]; demo: boolean } {
  const demo = useDemo();
  const { tenant } = useAuth();
  const [list, setList] = useState<Conversation[]>(() => demo ? DEMO_CONVERSATIONS : loadChatHistory(tenant?.id));
  useEffect(() => {
    if (demo) { setList(DEMO_CONVERSATIONS); return; }
    const refresh = () => setList(loadChatHistory(tenant?.id));
    refresh();
    return subscribeChatHistory(tenant?.id, refresh);
  }, [demo, tenant?.id]);
  // Live conversation history endpoint isn't available yet — empty until wired,
  // so no demo threads leak into a live build.
  return { list, demo };
}

export type { SectionSpec, ChatMsg };
