import { useState, type FormEvent } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase, centralIdentityOnly } from '../../../lib/supabase';
import { AdminPage, Button, Card, Grid, State } from './AdminPrimitives';
import { passwordIssue, displayNameIssue } from './profileLogic';

export function ProfilePage() {
  const { user, tenant } = useAuth();
  const meta = (user as { user_metadata?: Record<string, unknown> } | null)?.user_metadata || {};
  const [name, setName] = useState(String(meta.full_name || meta.name || ''));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const issue = displayNameIssue(name);
    if (issue) { setError(issue); setSaved(''); return; }
    setBusy('name'); setError(''); setSaved('');
    try {
      const { error: err } = await supabase.auth.updateUser({ data: { full_name: name.trim() } });
      if (err) throw err;
      setSaved('Name updated. It appears everywhere after your next sign-in or page refresh.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update name'); }
    finally { setBusy(''); }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    const issue = passwordIssue(password, confirm);
    if (issue) { setError(issue); setSaved(''); return; }
    setBusy('password'); setError(''); setSaved('');
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setPassword(''); setConfirm('');
      setSaved('Password changed. Use it the next time you sign in.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change password'); }
    finally { setBusy(''); }
  }

  return <AdminPage eyebrow="Account · Profile" lead="Your personal account — how you appear, and how you sign in. Workspace-wide settings live under Settings.">
    <Grid>
      <Card title="Signed in as" value={user?.email || '—'} />
      <Card title="Workspace" value={tenant?.name || '—'} />
    </Grid>
    {centralIdentityOnly ? (
      <Card title="Managed by shre-id">
        <p style={{ color: 'var(--muted)', lineHeight: 1.55 }}>
          This workspace signs in through shre-id, so your name, email, and password are managed there.
        </p>
        <Button type="button" onClick={() => window.open('https://id.shre.ai', '_blank', 'noopener')}>Open shre-id</Button>
      </Card>
    ) : <>
      <form className="rsx-form" onSubmit={saveName}>
        <label className="rsx-form__field"><span className="rsx-form__label">Display name</span>
          <input className="rsx-form__input" maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
        </label>
        <Button disabled={busy === 'name'}>{busy === 'name' ? 'Saving…' : 'Save name'}</Button>
      </form>
      <form className="rsx-form" onSubmit={savePassword}>
        <label className="rsx-form__field"><span className="rsx-form__label">New password</span>
          <input className="rsx-form__input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 10 characters, letters + a number" />
        </label>
        <label className="rsx-form__field"><span className="rsx-form__label">Confirm new password</span>
          <input className="rsx-form__input" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat the new password" />
        </label>
        <Button disabled={busy === 'password'}>{busy === 'password' ? 'Changing…' : 'Change password'}</Button>
      </form>
      <Card title="Email">
        <p style={{ color: 'var(--muted)', lineHeight: 1.55 }}>
          Your sign-in email is <strong>{user?.email || '—'}</strong>. Changing it requires re-verification — use “Forgot password” on the login page if you’ve lost access, or contact support to migrate the account email.
        </p>
      </Card>
    </>}
    {saved && <State title="Saved" detail={saved} />}
    {error && <State title="Something needs attention" detail={error} />}
  </AdminPage>;
}
