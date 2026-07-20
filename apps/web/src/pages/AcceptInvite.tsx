import { useEffect, useState, FormEvent } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Landing page for workspace-invite emails (/auth/accept).
 *
 * The Supabase invite link verifies the token server-side and redirects here
 * with session tokens in the URL hash; supabase-js (detectSessionInUrl, the
 * client default) consumes them on load. All this page has to do is wait for
 * that session, collect a password, and hand off into the app — the inviter
 * already created the workspace membership, so the invitee lands inside the
 * right workspace with no further setup.
 */
export function AcceptInvite() {
  const [phase, setPhase] = useState<'waiting' | 'form' | 'done' | 'dead'>('waiting');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The hash tokens are consumed asynchronously on load; poll briefly
    // instead of racing getSession once.
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        clearInterval(timer);
        setEmail(data.session.user.email || '');
        setPhase('form');
      } else if (Date.now() - startedAt > 8000) {
        clearInterval(timer);
        setPhase('dead');
      }
    }, 250);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) { setError(err.message); return; }
      setPhase('done');
      window.setTimeout(() => { window.location.href = '/start'; }, 1200);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.logo}>AROS</div>
          <p style={styles.tagline}>Agentic Retail Operating System</p>
        </div>
        <div style={styles.card}>
          {phase === 'waiting' && <p style={styles.desc}>Checking your invite…</p>}
          {phase === 'dead' && (
            <>
              <h2 style={styles.title}>This invite link didn't work</h2>
              <p style={styles.desc}>
                It may have expired or already been used. Ask the person who invited you to send a new one,
                or <a href="/reset-password" style={styles.link}>reset your password</a> if you already have an account.
              </p>
            </>
          )}
          {phase === 'form' && (
            <>
              <h2 style={styles.title}>Welcome to AROS</h2>
              <p style={styles.desc}>
                You've been invited{email ? <> as <strong>{email}</strong></> : null}. Choose a password to finish setting up your account.
              </p>
              <form onSubmit={handleSubmit} style={styles.form}>
                <div style={styles.field}>
                  <label style={styles.label}>Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" autoFocus style={styles.input} />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Confirm password</label>
                  <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" style={styles.input} />
                </div>
                {error && <div style={styles.error}>{error}</div>}
                <button type="submit" disabled={busy} style={styles.button}>{busy ? 'Saving…' : 'Set password & enter'}</button>
              </form>
            </>
          )}
          {phase === 'done' && <p style={styles.desc}>You're in — taking you to your workspace…</p>}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', padding: 16 },
  container: { width: '100%', maxWidth: 420 },
  header: { textAlign: 'center', marginBottom: 24 },
  logo: { fontSize: 28, fontWeight: 700, letterSpacing: 2 },
  tagline: { color: '#6b7280', fontSize: 13, marginTop: 4 },
  card: { background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: 28 },
  title: { fontSize: 20, fontWeight: 600, marginBottom: 8 },
  desc: { color: '#4b5563', fontSize: 14, lineHeight: 1.5, marginBottom: 8 },
  form: { display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: 500, color: '#374151' },
  input: { padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 },
  error: { color: '#b91c1c', fontSize: 13 },
  button: { padding: '10px 12px', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  link: { color: '#2563eb' },
};
