import { useState, FormEvent } from 'react';
import { safeReturnTo } from '../app-registry';
import { safeIssuerReturnTo } from '../lib/hosted-auth';
import { hostedAuth, type HostedChallenge } from '../lib/hosted-auth';
import { useArosTheme } from '../lib/useArosTheme';

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');
const AUTH_BASE = (window as any).__SHRE_AUTH_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5455' : '');

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
  const { label: themeLabel, toggle: toggleTheme } = useArosTheme();
  const returnTo = safeReturnTo(new URLSearchParams(window.location.search).get('returnTo'));
  const issuerReturnTo = safeIssuerReturnTo(new URLSearchParams(window.location.search).get('return_to'));
  const loginQuery = issuerReturnTo
    ? `return_to=${encodeURIComponent(issuerReturnTo)}`
    : `returnTo=${encodeURIComponent(returnTo)}`;
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
  const [hostedChallenge, setHostedChallenge] = useState<HostedChallenge | null>(null);

  // Password strength indicator
  const pwChecks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
  const pwStrength = Object.values(pwChecks).filter(Boolean).length;
  const strengthColor = pwStrength <= 2 ? 'var(--danger)' : pwStrength <= 3 ? 'var(--accent)' : 'var(--ok)';

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
      if (issuerReturnTo) {
        const challenge = await hostedAuth.signup(AUTH_BASE, {
          email, password, name: fullName, workspaceName: company,
          ...(phone ? { phoneNumber: phone } : {}),
        });
        setHostedChallenge(challenge);
        setStep('verify');
        return;
      }
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
      if (data.model?.enrollmentToken) {
        sessionStorage.setItem('aros-model-enrollment-token', String(data.model.enrollmentToken));
      }
      window.location.href = `/login?registered=true&email=${encodeURIComponent(email)}&${loginQuery}`;
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
      if (hostedChallenge && issuerReturnTo) {
        await hostedAuth.verifyTwoFactor(AUTH_BASE, hostedChallenge, otp);
        window.location.assign(issuerReturnTo);
        return;
      }
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

  const topbar = (withBack: boolean) => (
    <div className="aros-auth__topbar">
      {withBack ? (
        <button type="button" onClick={() => setStep('form')} style={{ background: 'none', border: 'none', color: 'var(--ink-2)', fontWeight: 600, fontSize: 13, padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
      ) : (
        <>
          <div className="aros-auth__brand-mark">A</div>
          <span className="aros-auth__brand-name">AROS</span>
          <span className="aros-auth__brand-by">by ShreAI</span>
        </>
      )}
      <div style={{ flex: 1 }} />
      <button type="button" className="aros-auth__theme-toggle" onClick={toggleTheme}>{themeLabel}</button>
    </div>
  );

  // ── Step: Verify Email ──────────────────────────────────────
  if (step === 'verify') {
    return (
      <div className="aros-auth">
        {topbar(true)}
        <div className="aros-auth__body">
          <div className="aros-auth__panel">
            <div className="aros-auth__headline aros-auth__headline--sm">Check your email</div>
            <p className="aros-auth__sub">
              We sent a 6-digit code to <strong style={{ color: 'var(--ink)' }}>{hostedChallenge?.destination || email}</strong>. It expires in 10 minutes.
            </p>
            <div className="aros-auth__card">
              <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <input
                  className="aros-auth__input"
                  type="text"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  style={{ textAlign: 'center', fontSize: 28, letterSpacing: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}
                />
                {otpError && <div className="aros-auth__error">{otpError}</div>}
                <button type="submit" disabled={loading || otp.length < 6} className="aros-auth__btn">
                  {loading ? 'Verifying…' : 'Verify & Continue'}
                </button>
                {!hostedChallenge && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button type="button" onClick={sendOtp} disabled={otpSending} className="aros-auth__link" style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                      {otpSending ? 'Sending…' : 'Resend code'}
                    </button>
                    <button type="button" onClick={() => setStep('done')} style={{ background: 'none', border: 'none', color: 'var(--ink-2)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                      Skip for now
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: Done ──────────────────────────────────────────────
  if (step === 'done') {
    window.location.href = `/login?registered=true&email=${encodeURIComponent(email)}&${loginQuery}`;
    return null;
  }

  // ── Step: Form ──────────────────────────────────────────────
  return (
    <div className="aros-auth">
      {topbar(false)}
      <div className="aros-auth__body">
        <div className="aros-auth__panel" style={{ maxWidth: 440 }}>
          <div className="aros-auth__headline">Run your stores by chatting.</div>
          <p className="aros-auth__sub">One chat that knows your registers, apps, and numbers. Create your account to start.</p>

          <div className="aros-auth__card">
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="aros-auth__label">Full name</label>
                <input className="aros-auth__input" type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Dana Reyes" required autoFocus />
              </div>

              <div>
                <label className="aros-auth__label">Work email</label>
                <input className="aros-auth__input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="dana@fivepointsmarket.com" required autoComplete="email" />
              </div>

              <div>
                <label className="aros-auth__label">Phone <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>(optional)</span></label>
                <input className="aros-auth__input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" autoComplete="tel" />
              </div>

              <div>
                <label className="aros-auth__label">Password</label>
                <input className="aros-auth__input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a strong password" required minLength={8} autoComplete="new-password" />
                {password.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= pwStrength ? strengthColor : 'var(--line)' }} />
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6, marginTop: 6 }}>
                  {password.length > 0 ? (
                    <>
                      <span style={{ color: pwChecks.length ? 'var(--ok)' : 'var(--ink-3)' }}>8+ chars</span>{' '}
                      <span style={{ color: pwChecks.upper ? 'var(--ok)' : 'var(--ink-3)' }}>uppercase</span>{' '}
                      <span style={{ color: pwChecks.lower ? 'var(--ok)' : 'var(--ink-3)' }}>lowercase</span>{' '}
                      <span style={{ color: pwChecks.number ? 'var(--ok)' : 'var(--ink-3)' }}>number</span>{' '}
                      <span style={{ color: pwChecks.special ? 'var(--ok)' : 'var(--ink-3)' }}>special</span>
                    </>
                  ) : (
                    'Min 8 chars with uppercase, lowercase, number, and special character'
                  )}
                </div>
              </div>

              <div>
                <label className="aros-auth__label">Company name</label>
                <input className="aros-auth__input" type="text" value={company} onChange={e => setCompany(e.target.value)} placeholder="Five Points Market" required />
              </div>

              <div>
                <label className="aros-auth__label">What do you want your agent to do?</label>
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
                          background: selected ? 'var(--accent-soft)' : 'var(--surface)',
                          border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
                          fontFamily: 'inherit', transition: 'border-color 0.15s, background 0.15s',
                        }}
                      >
                        <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>
                          <span style={{ marginRight: 6 }}>{opt.icon}</span>{opt.label}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{opt.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {error && <div className="aros-auth__error">{error}</div>}

              <button type="submit" disabled={loading} className="aros-auth__btn">
                {loading ? 'Creating account…' : 'Create account'}
              </button>

              <p style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, marginTop: 10, textAlign: 'center' }}>
                By creating an account you agree to the{' '}
                <a className="aros-auth__link" href="/legal/terms" target="_blank" rel="noreferrer">Terms of Service</a> and{' '}
                <a className="aros-auth__link" href="/legal/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
              </p>
            </form>
          </div>

          <p className="aros-auth__foot">
            Already have an account?{' '}
            <a className="aros-auth__link" href={`/login?${loginQuery}`}>Sign in</a>
            <br />
            By continuing you agree to the{' '}
            <a className="aros-auth__link" href="https://nirtek.net/terms.html" target="_blank" rel="noopener">Terms</a>
            {' '}and{' '}
            <a className="aros-auth__link" href="https://nirtek.net/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
