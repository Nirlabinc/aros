import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { AdminPage, Button, Card, Grid, Loading, State } from './AdminPrimitives';
import { workspaceApi, type WorkspaceRecord } from './workspaceApi';

export function SettingsPage() {
  const { tenant, session } = useAuth();
  const auth = useMemo(() => tenant ? { workspaceId: tenant.id, accessToken: session?.access_token } : null, [tenant?.id, session?.access_token]);
  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(null); const [loading, setLoading] = useState(Boolean(auth));
  const [error, setError] = useState(''); const [saved, setSaved] = useState(''); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', timezone: 'America/New_York', currency: 'USD' });
  async function load() { if (!auth) return; setLoading(true); setError(''); try { const value = await workspaceApi.get(auth); setWorkspace(value); setForm({ name: value.name || '', timezone: value.timezone || 'America/New_York', currency: value.currency || 'USD' }); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load workspace'); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, [auth]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(event: FormEvent) { event.preventDefault(); if (!auth) return; setBusy(true); setError(''); setSaved(''); try { const value = await workspaceApi.update(auth, form); setWorkspace(value); setSaved('Workspace settings saved.'); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save workspace'); } finally { setBusy(false); } }
  return <AdminPage eyebrow="Workspace · Settings" lead="Workspace defaults shared across AROS and MIB-compatible clients.">
    {!auth ? <State title="No workspace selected" detail="Choose a workspace to view settings." /> : loading ? <Loading /> : error && !workspace ? <State title="Settings unavailable" detail={error} retry={() => void load()} /> : <form className="rsx-form" onSubmit={save}>
      <label className="rsx-form__field"><span className="rsx-form__label">Workspace name</span><input className="rsx-form__input" required maxLength={120} value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} /></label>
      <label className="rsx-form__field"><span className="rsx-form__label">Timezone</span><select className="rsx-form__input" value={form.timezone} onChange={e => setForm(v => ({ ...v, timezone: e.target.value }))}><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option><option>UTC</option></select></label>
      <label className="rsx-form__field"><span className="rsx-form__label">Currency</span><select className="rsx-form__input" value={form.currency} onChange={e => setForm(v => ({ ...v, currency: e.target.value }))}><option>USD</option><option>CAD</option><option>GBP</option><option>EUR</option></select></label>
      <Button disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>{saved && <State title="Saved" detail={saved} />}{error && <State title="Save failed" detail={error} />}
      {workspace && <Grid><Card title="Plan" value={workspace.plan || '—'} /><Card title="Status" value={workspace.status || 'active'} /></Grid>}
    </form>}
  </AdminPage>;
}
