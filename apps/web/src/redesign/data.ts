import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  SECTIONS, USER as DEMO_USER, CONVERSATIONS as DEMO_CONVERSATIONS,
  SUGGESTIONS,
  type SectionSpec, type SectionKey, type Row, type Status, type Conversation, type ChatMsg,
} from './shellData';

// ============================================================================
// Live vs demo data. THE GUARANTEE: demo content (persona, figures, sample
// catalogs) only renders when there is NO real session — i.e. the public
// /preview/app route. A logged-in (live) build fetches real data and shows
// empty states; it NEVER shows the demo persona or numbers.
// ============================================================================

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

/** true = show demo data (preview, no session); false = live, real data only. */
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

export interface Identity { name: string; workspace: string; initials: string; role: string; }
export function useIdentity(): Identity {
  const { user, tenant } = useAuth();
  const demo = useDemo();
  if (demo) return { name: DEMO_USER.name, workspace: DEMO_USER.workspace, initials: DEMO_USER.initials, role: DEMO_USER.role };
  const meta = (user as any)?.user_metadata || {};
  const name = meta.full_name || meta.name || user?.email?.split('@')[0] || 'You';
  const workspace = tenant?.name || 'Your workspace';
  const initials = String(name).split(/\s+/).map((s: string) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'U';
  return { name, workspace, initials, role: 'Owner' };
}

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

    async function loadConnectors(isStore: boolean) {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/connectors`, { headers: headers(session, tenant) });
        const data = res.ok ? await res.json() : { connectors: [] };
        const conns = ((data.connectors || []) as any[])
          .filter(c => isStore ? POS_TYPES.includes(c.type) : !POS_TYPES.includes(c.type));
        const rows: Row[] = conns.map(c => ({
          mark: String(c.name || c.type || '?').slice(0, 2).toUpperCase(),
          title: c.name || c.type,
          sub: c.last_error || (c.status === 'connected' ? 'Connected' : 'Needs attention'),
          status: (c.status === 'connected' ? 'on' : c.status === 'error' ? 'off' : 'warn') as Status,
          statusLabel: c.status === 'connected' ? 'Connected' : c.status === 'error' ? 'Error' : 'Needs attention',
          action: 'Manage',
        }));
        if (alive) setSpec({ ...base, stats: [{ value: rows.filter(r => r.status === 'on').length, label: 'Connected' }, { value: rows.length, label: 'Total' }], rows });
      } catch { if (alive) setSpec({ ...base, rows: [] }); }
      finally { if (alive) setLoading(false); }
    }

    async function loadModels() {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/settings/models`, { headers: headers(session, tenant) });
        const data = res.ok ? await res.json() : {};
        const providers = (data.providers || data.models || []) as any[];
        const rows: Row[] = providers.map((p: any) => ({
          mark: String(p.label || p.provider || '?').slice(0, 2).toUpperCase(),
          title: p.label || p.provider,
          sub: p.model || p.endpoint || '',
          status: (p.active ? 'on' : 'off') as Status,
          statusLabel: p.active ? 'Active' : 'Add key',
          action: p.active ? 'Configure' : 'Connect',
        }));
        if (alive) setSpec({ ...base, rows });
      } catch { if (alive) setSpec({ ...base, rows: [] }); }
      finally { if (alive) setLoading(false); }
    }

    if (key === 'stores') loadConnectors(true);
    else if (key === 'apps') loadConnectors(false);
    else if (key === 'models') loadModels();
    else setSpec(base); // skills/agents/permissions/health/team/billing/usage/settings — empty until wired

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
export function useHomeData(): HomeData {
  const demo = useDemo();
  const id = useIdentity();
  if (demo) {
    return {
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
  }
  // Live: no store data until a register is connected; show empty, real state.
  return { greetingSub: `${id.workspace} · connect a register to see live numbers`, suggestions: SUGGESTIONS, kpis: [], approvals: [], activity: [] };
}

/** Canvas content blocks. Demo shows the example dashboard; live shows blocks
 *  emitted by Shre's replies (none until the first data answer). */
export function useCanvasDemo(): boolean { return useDemo(); }

export function useConversations(): { list: Conversation[]; demo: boolean } {
  const demo = useDemo();
  // Live conversation history comes from the chat store (not wired yet) — empty
  // until then, so no demo threads leak into a live build.
  return { list: demo ? DEMO_CONVERSATIONS : [], demo };
}

export type { SectionSpec, ChatMsg };
