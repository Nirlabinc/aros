import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

type Overview = { tenants: number; activeMemberships: number; connectors: Record<string, number>; newestSnapshotAt: string | null };
type TenantRow = { id: string; name: string; plan?: string; status?: string; pos_system?: string; store_count?: number; onboarding_completed?: boolean; created_at: string; members: number; connectors: { total: number; connected: number } };
type TenantDetail = {
  tenant: Record<string, unknown> & { id: string; name: string };
  members: Array<{ id: string; email: string | null; name: string | null; role: string; status: string; joined_at: string }>;
  connectors: Array<{ id: string; name: string; type: string; status: string; last_tested: string | null; last_error: string | null }>;
  onboarding: { phase?: string } | null;
  recentAudit: Array<{ action: string; resource: string | null; created_at: string }>;
};

type SortKey = 'name' | 'members' | 'connectors' | 'created_at';

/** Workspaces created by test tooling — QA fixtures, journey walkers, E2E
 * accounts. Name-based on purpose: no schema flag exists yet, and the
 * operator can always toggle them visible. */
const TEST_WORKSPACE_RE = /\b(QA|E2E|Test Store|Walk|Demo)\b/i;

/**
 * Founder-only, read-only cross-tenant console (/platform), themed on the
 * AROS design tokens (aros-design.css) so it follows light/dark like the
 * rest of the app. The server's PLATFORM_ADMIN_EMAILS allow-list is the real
 * gate — a 404 here renders the same "not available" shell an unknown route
 * would, revealing nothing.
 *
 * Chart hues are validated steps (dataviz six-checks) per mode: #b8842a on
 * the light surface, #b0862c on dark — set via the --pc-chart custom
 * property below, not hardcoded into marks.
 */
export function PlatformConsole() {
  const { session, loading } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [openTenant, setOpenTenant] = useState('');
  const [state, setState] = useState<'loading' | 'denied' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showTest, setShowTest] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  async function api<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}/api/platform${path}`, { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} });
    if (res.status === 404) throw new Error('__denied__');
    const payload = await res.json().catch(() => null);
    if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
    return payload as T;
  }

  useEffect(() => {
    if (loading) return;
    if (!session) { setState('denied'); return; }
    (async () => {
      try {
        const [ov, tn] = await Promise.all([api<Overview>('/overview'), api<{ tenants: TenantRow[] }>('/tenants')]);
        setOverview(ov); setTenants(tn.tenants); setState('ready');
      } catch (e) {
        if (e instanceof Error && e.message === '__denied__') setState('denied');
        else { setError(e instanceof Error ? e.message : 'Failed to load'); setState('error'); }
      }
    })();
  }, [loading, session?.access_token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleTenant(id: string) {
    if (openTenant === id) { setOpenTenant(''); setDetail(null); return; }
    setOpenTenant(id); setDetail(null);
    try { setDetail(await api<TenantDetail>(`/tenants/${id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load tenant'); }
  }

  function sortBy(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Test/QA workspaces (journey walkers, E2E fixtures) drown out real
    // customers in the default view (UX review) — hidden unless toggled.
    const base = showTest ? tenants : tenants.filter(t => !TEST_WORKSPACE_RE.test(t.name));
    const filtered = q ? base.filter(t => [t.name, t.pos_system, t.plan].some(v => (v || '').toLowerCase().includes(q))) : base;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortKey === 'members') return (a.members - b.members) * dir;
      if (sortKey === 'connectors') return (a.connectors.connected - b.connectors.connected) * dir;
      return a.created_at.localeCompare(b.created_at) * dir;
    });
  }, [tenants, query, sortKey, sortDir]);

  if (state === 'loading') return <Shell><p style={s.muted}>Loading…</p></Shell>;
  if (state === 'denied') return <Shell><h1 style={s.h1}>Not available</h1><p style={s.muted}>This page does not exist for this account.</p></Shell>;
  if (state === 'error') return <Shell><h1 style={s.h1}>Platform console</h1><p style={{ color: 'var(--danger-ink)' }}>{error}</p></Shell>;

  const conn = overview?.connectors || {};
  const connTotal = Object.values(conn).reduce((a, b) => a + b, 0);
  const snapshotAge = overview?.newestSnapshotAt ? Math.round((Date.now() - Date.parse(overview.newestSnapshotAt)) / 3600_000) : null;

  return (
    <Shell>
      <header>
        <div style={s.eyebrow}>Platform · Operator</div>
        <p style={s.lead}>Read-only view across every workspace. Access is allow-listed and audit-logged.</p>
      </header>

      <div style={s.grid}>
        <StatCard title="Workspaces" value={overview?.tenants ?? '—'} />
        <StatCard title="Active memberships" value={overview?.activeMemberships ?? '—'} />
        <StatCard title="Connectors connected" value={<>{conn.connected || 0}<span style={s.dimBig}>/{connTotal}</span></>} note={connTotal > (conn.connected || 0) ? { text: `${connTotal - (conn.connected || 0)} not connected`, tone: 'warn' } : undefined} />
        <StatCard title="Since last snapshot" value={snapshotAge === null ? '—' : `${snapshotAge}h`} note={snapshotAge !== null && snapshotAge > 13 ? { text: 'stale — check the sentinel', tone: 'warn' } : { text: 'fresh', tone: 'ok' }} />
      </div>

      <GrowthCard tenants={tenants} />

      <section>
        <div style={s.tableHead}>
          <h2 style={s.h2}>Workspaces</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--ink-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={showTest} onChange={e => setShowTest(e.target.checked)} />
              Show test workspaces ({tenants.filter(t => TEST_WORKSPACE_RE.test(t.name)).length})
            </label>
            <input
              type="search" placeholder="Search name, POS, plan…" aria-label="Search workspaces"
              value={query} onChange={e => setQuery(e.target.value)} style={s.search}
            />
          </div>
        </div>
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <Th label="Name" sortable active={sortKey === 'name'} dir={sortDir} onClick={() => sortBy('name')} />
                <Th label="Plan" /><Th label="POS" />
                <Th label="Members" sortable active={sortKey === 'members'} dir={sortDir} onClick={() => sortBy('members')} />
                <Th label="Connectors" sortable active={sortKey === 'connectors'} dir={sortDir} onClick={() => sortBy('connectors')} />
                <Th label="Onboarded" />
                <Th label="Created" sortable active={sortKey === 'created_at'} dir={sortDir} onClick={() => sortBy('created_at')} />
                <Th label="" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={8} style={{ ...s.td, color: 'var(--ink-3)' }}>No workspaces match. Adjust the search or enable test workspaces.</td></tr>}
              {visible.map(t => (
                <>
                  <tr key={t.id} style={openTenant === t.id ? { background: 'var(--surface-2)' } : undefined}>
                    <td style={s.td}><strong style={{ color: 'var(--ink)' }}>{t.name}</strong></td>
                    <td style={s.td}>{t.plan || '—'}</td>
                    <td style={s.td}>{t.pos_system || '—'}</td>
                    <td style={s.td}>{t.members}</td>
                    <td style={s.td}><ConnPill summary={t.connectors} /></td>
                    <td style={s.td}>{t.onboarding_completed ? <Pill tone="ok">yes</Pill> : <Pill>no</Pill>}</td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{t.created_at.slice(0, 10)}</td>
                    <td style={{ ...s.td, textAlign: 'right' }}><button style={s.btn} onClick={() => void toggleTenant(t.id)}>{openTenant === t.id ? 'Hide' : 'Inspect'}</button></td>
                  </tr>
                  {openTenant === t.id && (
                    <tr key={`${t.id}-detail`}>
                      <td colSpan={8} style={{ ...s.td, background: 'var(--surface-2)', padding: 0 }}>
                        <TenantInspect detail={detail} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={s.pageBg}>
      {/* Mode-selected chart hue — validated per surface, not a flipped light value. */}
      <style>{`
        :root { --pc-chart: #b8842a; }
        :root[data-aros-theme="dark"] { --pc-chart: #b0862c; }
        @media (prefers-color-scheme: dark) { :root:not([data-aros-theme]) { --pc-chart: #b0862c; } }
      `}</style>
      <div style={s.page}>{children}</div>
    </div>
  );
}

function StatCard({ title, value, note }: { title: string; value: React.ReactNode; note?: { text: string; tone: 'ok' | 'warn' } }) {
  return (
    <article style={s.card}>
      <div style={s.cardTitle}>{title}</div>
      <strong style={s.cardValue}>{value}</strong>
      {note && <div style={{ marginTop: 6 }}><Pill tone={note.tone === 'ok' ? 'ok' : 'danger'}>{note.text}</Pill></div>}
    </article>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'danger' }) {
  const tones: Record<string, React.CSSProperties> = {
    ok: { background: 'var(--ok-soft)', borderColor: 'var(--ok-line)', color: 'var(--ok-ink)' },
    danger: { background: 'var(--danger-soft)', borderColor: 'var(--danger-line)', color: 'var(--danger-ink)' },
  };
  return <span style={{ ...s.pill, ...(tone ? tones[tone] : {}) }}>{children}</span>;
}

function ConnPill({ summary }: { summary: { total: number; connected: number } }) {
  if (summary.total === 0) return <Pill>0/0</Pill>;
  if (summary.connected === summary.total) return <Pill tone="ok">{summary.connected}/{summary.total}</Pill>;
  return <Pill tone="danger">{summary.connected}/{summary.total}</Pill>;
}

function Th({ label, sortable, active, dir, onClick }: { label: string; sortable?: boolean; active?: boolean; dir?: 'asc' | 'desc'; onClick?: () => void }) {
  return (
    <th style={s.th} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {sortable ? (
        <button style={s.thBtn} onClick={onClick}>{label}{active && <span style={{ marginLeft: 4 }}>{dir === 'asc' ? '↑' : '↓'}</span>}</button>
      ) : label}
    </th>
  );
}

/** Cumulative workspaces over time — single series, so no legend; the title
 * names it. 2px line, endpoint marker + direct label; hover crosshair with a
 * tooltip; the workspaces table below is the data-table view. */
function GrowthCard({ tenants }: { tenants: TenantRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => {
    if (tenants.length === 0) return [];
    const days = [...tenants].map(t => t.created_at.slice(0, 10)).sort();
    const first = Date.parse(days[0]); const last = Date.now();
    const points: Array<{ day: string; count: number }> = [];
    for (let ts = first; ts <= last; ts += 86_400_000 * Math.max(1, Math.round((last - first) / 86_400_000 / 60))) {
      const day = new Date(ts).toISOString().slice(0, 10);
      points.push({ day, count: days.filter(d => d <= day).length });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (points[points.length - 1]?.day !== today) points.push({ day: today, count: days.length });
    return points;
  }, [tenants]);

  if (series.length < 2) return null;
  const W = 640, H = 120, PAD = 8;
  const max = Math.max(...series.map(p => p.count));
  const x = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (c: number) => H - PAD - (c / max) * (H - PAD * 2);
  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(' ');
  const hovered = hover !== null ? series[hover] : null;

  return (
    <article style={{ ...s.card, marginTop: 12 }}>
      <div style={s.cardTitle}>Workspaces over time</div>
      <div style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 120, display: 'block', marginTop: 8 }}
          role="img" aria-label={`Cumulative workspaces from ${series[0].day} to ${series[series.length - 1].day}, ending at ${series[series.length - 1].count}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={e => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const rel = (e.clientX - rect.left) / rect.width * W;
            const idx = Math.round((rel - PAD) / (W - PAD * 2) * (series.length - 1));
            setHover(Math.max(0, Math.min(series.length - 1, idx)));
          }}
        >
          {hover !== null && <line x1={x(hover)} y1={PAD} x2={x(hover)} y2={H - PAD} stroke="var(--line-strong)" strokeWidth="1" />}
          <path d={path} fill="none" stroke="var(--pc-chart)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(series.length - 1)} cy={y(series[series.length - 1].count)} r="4" fill="var(--pc-chart)" stroke="var(--surface)" strokeWidth="2" />
          {hover !== null && <circle cx={x(hover)} cy={y(series[hover].count)} r="4" fill="var(--pc-chart)" stroke="var(--surface)" strokeWidth="2" />}
        </svg>
        {hovered && (
          <div style={{ ...s.tooltip, left: `${(x(series.indexOf(hovered)) / W) * 100}%` }}>
            <strong style={{ color: 'var(--ink)' }}>{hovered.count}</strong> · {hovered.day}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={s.axisLabel}>{series[0].day}</span>
        <span style={{ ...s.axisLabel, color: 'var(--ink-2)' }}>now: <strong style={{ color: 'var(--ink)' }}>{series[series.length - 1].count}</strong></span>
      </div>
    </article>
  );
}

function TenantInspect({ detail }: { detail: TenantDetail | null }) {
  if (!detail) return <div style={{ padding: 16, color: 'var(--ink-3)' }}>Loading…</div>;
  return (
    <div style={{ padding: '14px 16px', display: 'grid', gap: 12 }}>
      <div>
        <div style={s.inspectLabel}>Members</div>
        {detail.members.length === 0 ? <span style={s.muted}>none</span> : detail.members.map(m => (
          <div key={m.id} style={s.inspectRow}>
            <span style={s.mark}>{(m.name || m.email || 'M').slice(0, 2).toUpperCase()}</span>
            <span style={{ color: 'var(--ink)' }}>{m.email || m.id}</span>
            <Pill>{m.role}</Pill>
            {m.status !== 'active' && <Pill tone="danger">{m.status}</Pill>}
          </div>
        ))}
      </div>
      <div>
        <div style={s.inspectLabel}>Connectors</div>
        {detail.connectors.length === 0 ? <span style={s.muted}>none</span> : detail.connectors.map(c => (
          <div key={c.id} style={s.inspectRow}>
            <span style={{ color: 'var(--ink)' }}>{c.name}</span>
            <span style={s.muted}>{c.type}</span>
            <Pill tone={c.status === 'connected' ? 'ok' : 'danger'}>{c.status}</Pill>
            {c.last_error && <span style={{ color: 'var(--danger-ink)', fontSize: 12 }}>{c.last_error}</span>}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><span style={s.inspectLabel}>Journey </span><Pill tone={detail.onboarding?.phase === 'ready' ? 'ok' : undefined}>{detail.onboarding?.phase || 'no state row'}</Pill></div>
      </div>
      {detail.recentAudit.length > 0 && (
        <div>
          <div style={s.inspectLabel}>Recent activity</div>
          <div style={{ color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.8 }}>
            {detail.recentAudit.slice(0, 8).map((a, i) => <div key={i}><span style={{ color: 'var(--ink-3)' }}>{a.created_at.slice(5, 16).replace('T', ' ')}</span> · {a.action}{a.resource ? ` — ${a.resource}` : ''}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  pageBg: { minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)', fontSize: 14 },
  page: { maxWidth: 1080, margin: '0 auto', padding: '32px 20px 48px', display: 'grid', gap: 20 },
  eyebrow: { color: 'var(--ink-3)', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' },
  lead: { color: 'var(--ink-2)', maxWidth: 680, margin: '6px 0 0', lineHeight: 1.55 },
  h1: { fontSize: 22, fontWeight: 700 },
  h2: { fontSize: 16, fontWeight: 650, margin: 0 },
  muted: { color: 'var(--ink-2)', fontSize: 13 },
  dimBig: { color: 'var(--ink-3)', fontWeight: 400 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12 },
  card: { border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', padding: 18, boxShadow: 'var(--shadow-card)' },
  cardTitle: { color: 'var(--ink-2)', fontSize: 13 },
  cardValue: { display: 'block', fontSize: 25, marginTop: 7, color: 'var(--ink)' },
  tableHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' },
  search: { border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 9, padding: '8px 12px', font: 'inherit', minWidth: 220 },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', boxShadow: 'var(--shadow-card)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 14px', borderBottom: '1px solid var(--line-strong)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-3)', whiteSpace: 'nowrap' },
  thBtn: { border: 'none', background: 'none', color: 'inherit', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', cursor: 'pointer', padding: 0 },
  td: { padding: '11px 14px', borderBottom: '1px solid var(--line)', color: 'var(--ink-2)', verticalAlign: 'top' },
  btn: { border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 9, padding: '5px 12px', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 600 },
  pill: { display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 999, padding: '2px 9px', fontSize: 12, color: 'var(--ink-2)', background: 'var(--surface)' },
  tooltip: { position: 'absolute', top: -6, transform: 'translateX(-50%)', background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 8, padding: '4px 9px', fontSize: 12, color: 'var(--ink-2)', boxShadow: 'var(--shadow-card)', pointerEvents: 'none', whiteSpace: 'nowrap' },
  axisLabel: { color: 'var(--ink-3)', fontSize: 11.5 },
  inspectLabel: { color: 'var(--ink-3)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6, fontWeight: 700 },
  inspectRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', flexWrap: 'wrap' },
  mark: { width: 28, height: 28, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 11, color: 'var(--ink-2)' },
};
