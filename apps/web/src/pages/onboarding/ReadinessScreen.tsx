import type { ReadinessItem, ReadinessState } from '../../onboarding/readiness';

/**
 * Readiness — the final journey step. Shows the real status of the four things
 * that make a workspace useful (model, store, sync, skills) and lets the user
 * enter the dashboard. Connecting a store stays optional, so the dashboard is
 * always reachable once a model is chosen.
 */
export function ReadinessScreen({ items, storeConnected, busy, onEnterDashboard, onConnectStore, onRefresh }: {
  items: ReadinessItem[];
  storeConnected: boolean;
  busy: boolean;
  onEnterDashboard: () => void;
  onConnectStore: () => void;
  onRefresh: () => void;
}) {
  return (
    <div style={s.card}>
      <div style={s.hero}>
        <div style={s.emoji}>🚀</div>
        <h2 style={s.title}>You're ready to go</h2>
        <p style={s.desc}>Here's where your workspace stands. You can enter the dashboard now — anything still preparing will keep working in the background.</p>
      </div>

      <div style={s.list}>
        {items.map((item) => (
          <div key={item.key} style={s.row}>
            <span style={{ ...s.dot, background: dotColor(item.state) }} />
            <div style={{ minWidth: 0 }}>
              <div style={s.rowTitle}>{item.label}</div>
              <div style={s.rowDetail}>{item.detail}</div>
            </div>
            <span style={{ ...s.pill, ...pillStyle(item.state) }}>{stateLabel(item.state)}</span>
          </div>
        ))}
      </div>

      <div style={s.actions}>
        <button type="button" onClick={onEnterDashboard} disabled={busy} style={s.primary}>
          {busy ? 'Finishing…' : 'Enter dashboard'}
        </button>
        {!storeConnected && (
          <button type="button" onClick={onConnectStore} disabled={busy} style={s.secondary}>
            Connect a store
          </button>
        )}
      </div>
      <button type="button" onClick={onRefresh} disabled={busy} style={s.refresh}>Refresh status</button>
    </div>
  );
}

function dotColor(state: ReadinessState): string {
  return state === 'ready' ? '#10b981' : state === 'pending' ? '#f59e0b' : '#9ca3af';
}
function stateLabel(state: ReadinessState): string {
  return state === 'ready' ? 'Ready' : state === 'pending' ? 'In progress' : 'Optional';
}
function pillStyle(state: ReadinessState): React.CSSProperties {
  if (state === 'ready') return { background: '#ecfdf5', color: '#059669' };
  if (state === 'pending') return { background: '#fffbeb', color: '#b45309' };
  return { background: '#f3f4f6', color: '#6b7280' };
}

const ACCENT = '#3b5bdb';
const s: Record<string, React.CSSProperties> = {
  card: { background: '#fff', borderRadius: 16, padding: '32px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e5e7eb', maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  hero: { textAlign: 'center' },
  emoji: { fontSize: 40 },
  title: { fontSize: 22, fontWeight: 800, color: '#1a1a2e', margin: '8px 0 6px' },
  desc: { fontSize: 14, color: '#6b7280', margin: 0, lineHeight: 1.5 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  row: { display: 'flex', alignItems: 'center', gap: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px' },
  dot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  rowTitle: { fontSize: 14, fontWeight: 700, color: '#1a1a2e' },
  rowDetail: { fontSize: 13, color: '#6b7280', lineHeight: 1.4 },
  pill: { marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' },
  actions: { display: 'flex', gap: 12 },
  primary: { flex: 1, padding: '14px 0', background: ACCENT, color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  secondary: { flex: 1, padding: '14px 0', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  refresh: { background: 'none', border: 'none', color: ACCENT, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
};
