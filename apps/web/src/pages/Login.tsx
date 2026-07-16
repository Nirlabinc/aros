import { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { safeReturnTo } from '../app-registry';
import { hostedAuth, safeIssuerReturnTo, type HostedChallenge, type HostedWorkspace } from '../lib/hosted-auth';
import { useArosTheme } from '../lib/useArosTheme';

const AUTH_BASE = (window as any).__SHRE_AUTH_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5455' : '');

export function Login() {
  const { signIn } = useAuth();
  const { label: themeLabel, toggle: toggleTheme } = useArosTheme();
  const params = new URLSearchParams(window.location.search);
  const justRegistered = params.get('registered') === 'true';
  const prefillEmail = params.get('email') || '';
  const returnTo = safeReturnTo(params.get('returnTo'));
  const issuerReturnTo = safeIssuerReturnTo(params.get('return_to'));
  const hosted = issuerReturnTo !== null;
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [workspaces, setWorkspaces] = useState<HostedWorkspace[]>([]);
  const [challenge, setChallenge] = useState<HostedChallenge | null>(null);
  const [code, setCode] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (hosted) {
        const result = await hostedAuth.login(AUTH_BASE, email, password);
        if ('requiresWorkspaceSelection' in result) {
          setTempToken(result.tempToken);
          setWorkspaces(result.workspaces);
        } else {
          setChallenge(result);
        }
        return;
      }
      const { error: err } = await signIn(email, password);
      if (err) {
        setError(err);
        return;
      }
      window.location.href = returnTo;
    } catch (cause) {
      setError(hosted && cause instanceof Error ? cause.message : 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function chooseWorkspace(workspaceId: string) {
    setError(''); setLoading(true);
    try { setChallenge(await hostedAuth.selectWorkspace(AUTH_BASE, tempToken, workspaceId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not select workspace'); }
    finally { setLoading(false); }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    if (!challenge || !issuerReturnTo) return;
    setError(''); setLoading(true);
    try {
      await hostedAuth.verifyTwoFactor(AUTH_BASE, challenge, code);
      window.location.assign(issuerReturnTo);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Verification failed'); }
    finally { setLoading(false); }
  }

  return (
    <div className="aros-auth">
      <div className="aros-auth__topbar">
        <div className="aros-auth__brand-mark">A</div>
        <span className="aros-auth__brand-name">AROS</span>
        <span className="aros-auth__brand-by">by ShreAI</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="aros-auth__theme-toggle" onClick={toggleTheme}>{themeLabel}</button>
      </div>

      <div className="aros-auth__body">
        <div className="aros-auth__panel">
          <div className="aros-auth__headline aros-auth__headline--sm">Welcome back.</div>
          <p className="aros-auth__sub">
            {hosted ? 'Sign in once to continue securely to your app.' : 'Sign in to keep running your stores by chat.'}
          </p>

          <div className="aros-auth__card">
            {justRegistered && (
              <div className="aros-auth__notice">Account created. Sign in to get started.</div>
            )}

            {workspaces.length > 0 && !challenge ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="aros-auth__label" style={{ marginBottom: 0 }}>Choose a workspace</div>
                {workspaces.map(workspace => (
                  <button key={workspace.id} type="button" disabled={loading} className="aros-auth__btn-ghost" onClick={() => void chooseWorkspace(workspace.id)}>
                    {workspace.name} · {workspace.role}
                  </button>
                ))}
                {error && <div className="aros-auth__error">{error}</div>}
              </div>
            ) : challenge ? (
              <form onSubmit={verifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0 }}>Enter the code sent to {challenge.destination}.</p>
                <div>
                  <label className="aros-auth__label">Verification code</label>
                  <input className="aros-auth__input" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required minLength={6} autoFocus />
                </div>
                {error && <div className="aros-auth__error">{error}</div>}
                <button type="submit" disabled={loading || code.length !== 6} className="aros-auth__btn">{loading ? 'Verifying…' : 'Verify & Continue'}</button>
              </form>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="aros-auth__label" htmlFor="login-email">Work email</label>
                  <input id="login-email" className="aros-auth__input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="dana@fivepointsmarket.com" required autoFocus />
                </div>
                <div>
                  <label className="aros-auth__label" htmlFor="login-password">Password</label>
                  <input id="login-password" className="aros-auth__input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
                </div>
                {error && <div className="aros-auth__error">{error}</div>}
                <button type="submit" disabled={loading} className="aros-auth__btn">{loading ? 'Signing in…' : 'Sign in'}</button>
              </form>
            )}
          </div>

          {!hosted && workspaces.length === 0 && !challenge && (
            <p className="aros-auth__foot">
              New to AROS?{' '}
              <a className="aros-auth__link" href={`/signup?returnTo=${encodeURIComponent(returnTo)}`}>Create an account</a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
