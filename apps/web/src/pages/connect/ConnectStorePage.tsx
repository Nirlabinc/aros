import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext';

/**
 * ConnectStorePage — the "connect your store" step of the journey.
 *
 * Value-first flow: users arrive here from the /start demo chat (or the
 * dashboard sample-data banner) once they're sold. Credentials are sent over
 * TLS and encrypted server-side (AES-256-GCM) — never stored or echoed back.
 */

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

type ProviderId = 'rapidrms-api' | 'verifone-commander' | 'azure-db';

interface ProviderDef {
  id: ProviderId;
  label: string;
  tagline: string;
  fields: Array<{ key: string; label: string; placeholder: string; secret?: boolean; optional?: boolean }>;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: 'rapidrms-api',
    label: 'RapidRMS POS',
    tagline: 'Cloud POS — sales, inventory, pricing, promotions',
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'Your RapidRMS client ID' },
      { key: 'email', label: 'Account Email', placeholder: 'you@yourstore.com', secret: true },
      { key: 'password', label: 'Password', placeholder: 'RapidRMS password', secret: true },
    ],
  },
  {
    id: 'verifone-commander',
    label: 'Verifone Commander',
    tagline: 'On-site Commander — fuel + c-store transaction data',
    fields: [
      { key: 'commanderIp', label: 'Commander IP', placeholder: '192.168.31.11' },
      { key: 'username', label: 'CGI Username', placeholder: 'Commander username' },
      { key: 'password', label: 'Password', placeholder: 'Commander password', secret: true },
    ],
  },
  {
    id: 'azure-db',
    label: 'Azure SQL Database',
    tagline: 'Direct database access to your back-office data',
    fields: [
      { key: 'server', label: 'Server', placeholder: 'yourserver.database.windows.net' },
      { key: 'database', label: 'Database', placeholder: 'Database name' },
      { key: 'username', label: 'Username', placeholder: 'SQL username' },
      { key: 'port', label: 'Port', placeholder: '1433', optional: true },
      { key: 'password', label: 'Password', placeholder: 'SQL password', secret: true },
    ],
  },
];

interface ConnectorRow {
  id: string;
  type: ProviderId;
  name: string;
  status: 'pending' | 'connected' | 'disconnected' | 'error';
  last_tested?: string | null;
  last_error?: string | null;
}

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  connected: { bg: '#ecfdf5', fg: '#059669', label: 'Connected' },
  pending: { bg: '#fffbeb', fg: '#b45309', label: 'Not tested' },
  error: { bg: '#fef2f2', fg: '#dc2626', label: 'Error' },
  disconnected: { bg: '#f3f4f6', fg: '#6b7280', label: 'Disconnected' },
};

export function ConnectStorePage({ onboarded }: { onboarded: boolean }) {
  const { session, tenant } = useAuth();
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [provider, setProvider] = useState<ProviderDef>(PROVIDERS[0]);
  const [storeName, setStoreName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [justConnected, setJustConnected] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}),
  }), [session, tenant]);

  const loadConnectors = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/connectors`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setConnectors(data.connectors || []);
      }
    } catch { /* list is best-effort; forms still work */ }
  }, [authHeaders]);

  useEffect(() => { void loadConnectors(); }, [loadConnectors]);

  const hasConnected = connectors.some((c) => c.status === 'connected');

  async function testConnector(id: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/api/connectors/test`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    await loadConnectors();
    if (!res.ok) throw new Error(data.error || 'Connection test failed');
    return Boolean(data.result?.success);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    setBusy('save');
    try {
      const secrets: Record<string, string> = {};
      const config: Record<string, unknown> = {};
      for (const f of provider.fields) {
        const v = (values[f.key] || '').trim();
        if (!v && !f.optional) throw new Error(`${f.label} is required`);
        if (f.secret) secrets[f.key] = v;
        else if (v) config[f.key] = f.key === 'port' ? Number(v) : v;
      }

      const saveRes = await fetch(`${API_BASE}/api/connectors`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          type: provider.id,
          name: storeName.trim() || `${provider.label} — ${tenant?.name || 'My Store'}`,
          config,
          secrets,
        }),
      });
      const saved = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) throw new Error(saved.error || 'Could not save connector');

      const ok = await testConnector(saved.connector.id);
      if (ok) {
        setJustConnected(true);
        setValues({});
        setStoreName('');
      } else {
        setFormError('Saved, but the connection test failed. Check the details and hit Test again below.');
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function handleRowTest(id: string) {
    setBusy(`test-${id}`);
    try { await testConnector(id); } catch { /* status refresh shows the error */ }
    setBusy(null);
  }

  async function handleRowRemove(id: string) {
    setBusy(`rm-${id}`);
    try {
      await fetch(`${API_BASE}/api/connectors?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      await loadConnectors();
    } finally {
      setBusy(null);
    }
  }

  const nextHref = onboarded ? '/dashboard' : '/onboarding';
  const nextLabel = onboarded ? 'Go to dashboard' : 'Finish setup';

  return (
    <div style={s.wrapper}>
      <div style={s.container}>
        <header style={s.header}>
          <h1 style={s.h1}>Connect your store</h1>
          <p style={s.sub}>
            Link your POS or back-office so your agents work with your real numbers.
            Credentials are encrypted and never shown again.
          </p>
        </header>

        {(justConnected || hasConnected) && (
          <div style={s.successBar}>
            <span>✓ Store connected — your agents are switching to live data.</span>
            <a href={nextHref} style={s.successCta}>{nextLabel}</a>
          </div>
        )}

        {connectors.length > 0 && (
          <section style={s.card}>
            <h2 style={s.cardTitle}>Your connections</h2>
            {connectors.map((c) => {
              const st = STATUS_STYLES[c.status] ?? STATUS_STYLES.pending;
              return (
                <div key={c.id} style={s.connRow}>
                  <div style={{ minWidth: 0 }}>
                    <div style={s.connName}>{c.name}</div>
                    <div style={s.connMeta}>
                      {PROVIDERS.find((p) => p.id === c.type)?.label ?? c.type}
                      {c.last_tested ? ` · tested ${new Date(c.last_tested).toLocaleString()}` : ''}
                      {c.status === 'error' && c.last_error ? ` · ${c.last_error}` : ''}
                    </div>
                  </div>
                  <span style={{ ...s.pill, background: st.bg, color: st.fg }}>{st.label}</span>
                  <button onClick={() => void handleRowTest(c.id)} disabled={busy !== null} style={s.smallBtn}>
                    {busy === `test-${c.id}` ? 'Testing…' : 'Test'}
                  </button>
                  <button onClick={() => void handleRowRemove(c.id)} disabled={busy !== null} style={{ ...s.smallBtn, color: '#dc2626' }}>
                    Remove
                  </button>
                </div>
              );
            })}
          </section>
        )}

        <section style={s.card}>
          <h2 style={s.cardTitle}>Add a connection</h2>
          <div style={s.providerGrid}>
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setProvider(p); setValues({}); setFormError(''); }}
                style={{ ...s.providerCard, ...(provider.id === p.id ? s.providerCardActive : {}) }}
              >
                <span style={s.providerLabel}>{p.label}</span>
                <span style={s.providerTagline}>{p.tagline}</span>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={s.form}>
            <div style={s.field}>
              <label style={s.label}>Connection Name</label>
              <input
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder={`e.g. Main Street — ${provider.label}`}
                style={s.input}
              />
            </div>
            {provider.fields.map((f) => (
              <div key={f.key} style={s.field}>
                <label style={s.label}>{f.label}{f.optional ? ' (optional)' : ''}</label>
                <input
                  type={f.secret && f.key !== 'email' ? 'password' : 'text'}
                  value={values[f.key] || ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  autoComplete="off"
                  style={s.input}
                />
              </div>
            ))}
            {formError && <div style={s.error}>{formError}</div>}
            <button type="submit" disabled={busy !== null} style={s.primaryBtn}>
              {busy === 'save' ? 'Connecting…' : 'Save & Test Connection'}
            </button>
          </form>
        </section>

        <p style={s.skip}>
          Not ready? <a href={onboarded ? '/dashboard' : '/onboarding'} style={s.skipLink}>
            {onboarded ? 'Back to dashboard' : 'Back to setup'}
          </a>
        </p>
      </div>
    </div>
  );
}

const ACCENT = '#3b5bdb';
const s: Record<string, React.CSSProperties> = {
  wrapper: { minHeight: '100vh', background: '#f7f8fc', fontFamily: 'Inter, system-ui, sans-serif', color: '#1a1a2e', padding: '40px 20px' },
  container: { maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  header: { textAlign: 'center' },
  h1: { fontSize: 26, fontWeight: 800, margin: '0 0 8px' },
  sub: { fontSize: 14, color: '#6b7280', margin: 0, lineHeight: 1.5 },
  successBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 12, padding: '12px 16px', fontSize: 14, fontWeight: 600 },
  successCta: { background: '#059669', color: '#fff', textDecoration: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  cardTitle: { fontSize: 16, fontWeight: 800, margin: '0 0 16px' },
  connRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid #f3f4f6' },
  connName: { fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  connMeta: { fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  pill: { marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' },
  smallBtn: { background: 'none', border: '1px solid #d1d5db', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#374151', fontFamily: 'inherit' },
  providerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 20 },
  providerCard: { display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit' },
  providerCardActive: { border: `2px solid ${ACCENT}`, background: '#f0f4ff', padding: '11px 13px' },
  providerLabel: { fontSize: 14, fontWeight: 700, color: '#1a1a2e' },
  providerTagline: { fontSize: 12, color: '#6b7280', lineHeight: 1.4 },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 13, fontWeight: 600, color: '#374151' },
  input: { padding: '11px 13px', border: '1px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none' },
  error: { padding: '10px 14px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, fontSize: 13, fontWeight: 500 },
  primaryBtn: { padding: '13px 0', background: ACCENT, color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  skip: { textAlign: 'center', fontSize: 13, color: '#9ca3af', margin: 0 },
  skipLink: { color: ACCENT, fontWeight: 600, textDecoration: 'none' },
};
