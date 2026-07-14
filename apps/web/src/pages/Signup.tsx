import { useState, FormEvent } from 'react';

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

// One question instead of a config wizard: what the operator wants their agent
// to do. This single answer seeds sensible model/tool defaults downstream — the
// user never has to pick a "model". Retail-forward, but covers generic SMB jobs.
const INTENTS = [
  { value: 'sales-inventory', icon: '📊', label: 'Track sales & inventory', hint: 'Daily numbers, low stock, reorders' },
  { value: 'customer-support', icon: '💬', label: 'Answer customer questions', hint: 'Hours, products, support' },
  { value: 'staff-scheduling', icon: '🧑‍🤝‍🧑', label: 'Manage staff & scheduling', hint: 'Labor, shifts, performance' },
  { value: 'exploring', icon: '✨', label: 'Just exploring', hint: 'Show me what AROS can do' },
];

type Step = 'form' | 'verify' | 'done';

function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(pw)) return 'Must contain an uppercase letter';
  if (!/[a-z]/.test(pw)) return 'Must contain a lowercase letter';
  if (!/[0-9]/.test(pw)) return 'Must contain a number';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Must contain a special character (!@#$...)';
  return null;
}

function validatePhone(phone: string): boolean {
  // Strip formatting, require 10+ digits
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

export function Signup() {
  const [step, setStep] = useState<Step>('form');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [intent, setIntent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Verification state
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpSending, setOtpSending] = useState(false);

  // Password strength indicator
  const pwChecks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
  const pwStrength = Object.values(pwChecks).filter(Boolean).length;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const pwError = validatePassword(password);
    if (pwError) { setError(pwError); return; }

    if (phone && !validatePhone(phone)) {
      setError('Please enter a valid phone number (10+ digits)');
      return;
    }

    if (!intent) {
      setError('Please pick what you want your agent to do');
      return;
    }

    // Persist the intent so the demo chat / provisioning can seed defaults from it.
    try { localStorage.setItem('aros-intent', intent); } catch { /* non-fatal */ }

    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fullName,
          email,
          password,
          company,
          phone: phone || undefined,
          intent,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Signup failed. Please try again.');
        return;
      }

      // Account created with email auto-confirmed server-side — go to login
      window.location.href = `/login?registered=true&email=${encodeURIComponent(email)}`;
      return;
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function sendOtp() {
    setOtpSending(true);
    setOtpError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/email-otp/send-verification-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        // OTP service unavailable — skip verification, account already confirmed server-side
        setStep('done');
      }
    } catch {
      // OTP unavailable — proceed to done
      setStep('done');
    } finally {
      setOtpSending(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setOtpError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/email-otp/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });

      if (res.ok) {
        setStep('done');
      } else {
        setOtpError('Invalid or expired code. Please try again.');
      }
    } catch {
      setOtpError('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Step: Verify Email ──────────────────────────────────────
  if (step === 'verify') {
    return (
      <div style={styles.wrapper}>
        <div style={styles.container}>
          <div style={styles.header}>
            <div style={styles.logo}>AROS</div>
          </div>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Verify your email</h2>
            <p style={{ fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 24, lineHeight: 1.5 }}>
              We sent a 6-digit code to <strong style={{ color: '#1a1a2e' }}>{email}</strong>
            </p>

            <form onSubmit={handleVerify} style={styles.form}>
              <input
                type="text"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                required
                autoFocus
                style={{ ...styles.input, textAlign: 'center', fontSize: 28, letterSpacing: 10, fontWeight: 700 }}
              />

              {otpError && <div style={styles.error}>{otpError}</div>}

              <button
                type="submit"
                disabled={loading || otp.length < 6}
                style={loading || otp.length < 6 ? { ...styles.button, opacity: 0.6 } : styles.button}
              >
                {loading ? 'Verifying...' : 'Verify & Continue'}
              </button>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={sendOtp}
                  disabled={otpSending}
                  style={styles.linkBtn}
                >
                  {otpSending ? 'Sending...' : 'Resend code'}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('done')}
                  style={styles.linkBtn}
                >
                  Skip for now
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: Done ──────────────────────────────────────────────
  if (step === 'done') {
    window.location.href = `/login?registered=true&email=${encodeURIComponent(email)}`;
    return null;
  }

  // ── Step: Form ──────────────────────────────────────────────
  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.logo}>AROS</div>
          <p style={styles.tagline}>Agentic Retail Operating System</p>
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Create your account</h2>

          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label}>Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="John Smith"
                required
                autoFocus
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@yourstore.com"
                required
                autoComplete="email"
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Phone <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span></label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                autoComplete="tel"
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Create a strong password"
                required
                minLength={8}
                autoComplete="new-password"
                style={styles.input}
              />
              {password.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} style={{
                      flex: 1, height: 4, borderRadius: 2,
                      background: i <= pwStrength
                        ? pwStrength <= 2 ? '#ef4444' : pwStrength <= 3 ? '#f59e0b' : '#22c55e'
                        : '#e5e7eb',
                    }} />
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
                {password.length > 0 ? (
                  <>
                    <span style={{ color: pwChecks.length ? '#22c55e' : '#9ca3af' }}>8+ chars</span>{' '}
                    <span style={{ color: pwChecks.upper ? '#22c55e' : '#9ca3af' }}>uppercase</span>{' '}
                    <span style={{ color: pwChecks.lower ? '#22c55e' : '#9ca3af' }}>lowercase</span>{' '}
                    <span style={{ color: pwChecks.number ? '#22c55e' : '#9ca3af' }}>number</span>{' '}
                    <span style={{ color: pwChecks.special ? '#22c55e' : '#9ca3af' }}>special</span>
                  </>
                ) : (
                  'Min 8 chars with uppercase, lowercase, number, and special character'
                )}
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Company Name</label>
              <input
                type="text"
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder="Smith's Corner Market"
                required
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>What do you want your agent to do?</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {INTENTS.map(opt => {
                  const selected = intent === opt.value;
                  return (
                    <button
                      type="button"
                      key={opt.value}
                      onClick={() => setIntent(opt.value)}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left',
                        padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                        background: selected ? '#eef2ff' : '#fff',
                        border: `1.5px solid ${selected ? '#3b5bdb' : '#d1d5db'}`,
                        fontFamily: 'inherit', transition: 'border-color 0.15s, background 0.15s',
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 600, color: '#1a1a2e' }}>
                        <span style={{ marginRight: 6 }}>{opt.icon}</span>{opt.label}
                      </span>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>{opt.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <button
              type="submit"
              disabled={loading}
              style={loading ? { ...styles.button, opacity: 0.6 } : styles.button}
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p style={styles.footer}>
            Already have an account?{' '}
            <a href="/login" style={styles.link}>Sign in</a>
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
    maxWidth: 480,
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
  linkBtn: {
    background: 'none',
    border: 'none',
    color: '#3b5bdb',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
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
  },
  legal: {
    textAlign: 'center' as const,
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 20,
  },
};
