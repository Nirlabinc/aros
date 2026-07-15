import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

type PlatformApp = {
  id: string;
  name: string;
  launch_url: string;
  repo: string;
  required_scopes: string[];
  status: 'active' | 'partial' | 'migration-needed' | 'planned';
};

type AppGrant = { app_key: string; status: string; service_config?: { scopes?: string[] } };

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

export function PlatformAppsPage() {
  const { session, tenant } = useAuth();
  const [apps, setApps] = useState<PlatformApp[]>([]);
  const [grants, setGrants] = useState<AppGrant[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const headers = useCallback(() => ({
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(tenant?.id ? { 'X-AROS-Tenant-Id': tenant.id } : {}),
  }), [session?.access_token, tenant?.id]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    const response = await fetch(`${API_BASE}/api/apps`, { headers: headers() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not load platform apps');
    setApps(payload.apps || []);
    setGrants(payload.grants || []);
  }, [headers, session?.access_token]);

  useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);

  async function grant(app: PlatformApp) {
    setBusy(app.id);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/apps/${app.id}/grant`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes: app.required_scopes || [] }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Grant failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Grant failed');
    } finally {
      setBusy(null);
    }
  }

  return <section className="setup-page">
    <header className="setup-header">
      <div><p className="setup-eyebrow">Workspace access</p><h1>AROS apps</h1>
        <p>Grant tenant-scoped capabilities to platform apps. Each app keeps its own vault namespace; credentials are never copied between repositories.</p></div>
    </header>

    {error && <div className="test-success" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}><strong>App access error</strong><span>{error}</span></div>}

    <div className="connection-list">
      {apps.map(app => {
        const granted = grants.some(g => g.app_key === app.id && g.status === 'active');
        const launchable = granted && (app.status === 'active' || app.status === 'partial');
        const statusLabel = app.status === 'migration-needed' ? 'SSO migration required' : app.status.replace('-', ' ');
        return <article className="connection-card" key={app.id}>
          <div className="provider-mark">{app.name.slice(0, 2).toUpperCase()}</div>
          <div className="connection-info"><h2>{app.name}</h2><p>{app.repo} · {(app.required_scopes || []).join(', ') || 'No scopes requested'}</p></div>
          <span className={`status-pill ${granted ? 'connected' : 'needs-attention'}`}>{granted ? 'Granted' : statusLabel}</span>
          {!granted && <button className="setup-secondary" disabled={app.status === 'planned' || busy === app.id} onClick={() => void grant(app)}>
            {busy === app.id ? 'Granting…' : app.status === 'planned' ? 'Planned' : 'Review & grant'}
          </button>}
          {granted && launchable && <a className="setup-secondary" href={app.launch_url}>Open</a>}
          {granted && !launchable && <button className="setup-secondary" disabled>{app.status === 'planned' ? 'Planned' : 'Awaiting SSO migration'}</button>}
        </article>;
      })}
    </div>

    <div className="oauth-box"><strong>Third-party apps</strong><p>Google Workspace, Microsoft 365, Slack, accounting, CRM, and support providers will appear here only when their real OAuth callback and multi-account mapping are configured. AROS will not simulate authorization.</p></div>
  </section>;
}
