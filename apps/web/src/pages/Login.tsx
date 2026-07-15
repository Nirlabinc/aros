import { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { safeReturnTo } from '../app-registry';

export function Login() {
  const { signIn } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const justRegistered = params.get('registered') === 'true';
  const prefillEmail = params.get('email') || '';
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: err } = await signIn(email, password);
      if (err) {
        setError(err);
        return;
      }
      window.location.href = returnTo;
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
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
          <h2 style={styles.cardTitle}>Sign in to your account</h2>

          {justRegistered && (
            <div style={{ padding: '10px 14px', background: '#f0fdf4', color: '#16a34a', borderRadius: 8, fontSize: 13, fontWeight: 500, marginBottom: 16, border: '1px solid #bbf7d0' }}>
              Account created successfully! Sign in to get started.
            </div>
          )}

          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@yourstore.com"
                required
                autoComplete="email"
                autoFocus
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
                style={styles.input}
              />
              <div style={{ textAlign: 'right' }}>
                <a href="/reset-password" style={styles.link}>Forgot password?</a>
              </div>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <button
              type="submit"
              disabled={loading}
              style={loading ? { ...styles.button, opacity: 0.6 } : styles.button}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p style={styles.footer}>
            Don't have an account?{' '}
            <a href={`/signup?returnTo=${encodeURIComponent(returnTo)}`} style={styles.link}>Create one</a>
          </p>
        </div>

        <p style={styles.legal}>
          By continuing, you agree to our{' '}
          <a href="https://nirtek.net/terms.html" style={styles.link} target="_blank" rel="noopener">Terms</a>
          {' '}and{' '}
          <a href="https://nirtek.net/privacy.html" style={styles.link} target="_blank" rel="noopener">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #f0f4ff 0%, #e8ecf8 50%, #f5f3ff 100%)',
    padding: 24,
  },
  container: {
    width: '100%',
    maxWidth: 420,
  },
  header: {
    textAlign: 'center' as const,
    marginBottom: 32,
  },
  logo: {
    fontSize: 32,
    fontWeight: 800,
    letterSpacing: -1,
    color: '#1a1a2e',
  },
  tagline: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '32px 28px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    border: '1px solid #e5e7eb',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 800,
    color: '#1a1a2e',
    marginBottom: 24,
    textAlign: 'center' as const,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
  },
  input: {
    padding: '12px 14px',
    border: '1px solid #d1d5db',
    borderRadius: 10,
    fontSize: 15,
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  error: {
    padding: '10px 14px',
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
  },
  button: {
    padding: '14px 0',
    background: '#3b5bdb',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginTop: 4,
    transition: 'background 0.2s',
  },
  footer: {
    textAlign: 'center' as const,
    fontSize: 13,
    color: '#6b7280',
    marginTop: 20,
  },
  link: {
    color: '#3b5bdb',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: 13,
  },
  legal: {
    textAlign: 'center' as const,
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 20,
  },
};
