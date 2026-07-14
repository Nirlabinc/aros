import { useState, useEffect, FormEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext';

type OnboardingStep = 'verify-email' | 'choose-plan' | 'payment' | 'business-setup' | 'complete';

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost'
    ? 'http://localhost:5457'
    : '');

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Self-hosted, 1 store',
    features: ['1 store, 1 user', 'Local AI (Ollama)', 'Basic dashboards', 'Community support'],
    cta: 'Start Free',
    popular: false,
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$49',
    period: '/mo per store',
    description: 'Managed hosting, cloud AI',
    features: ['1 store, 3 users', '5 AI agents', 'Cloud AI (Haiku)', 'Daily backups', 'Email support'],
    cta: 'Get Started',
    popular: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$149',
    period: '/mo per store',
    description: 'Advanced analytics',
    features: ['Up to 10 stores', '14 AI agents', 'Cloud AI (Sonnet)', 'Custom dashboards', 'API access', 'Priority support'],
    cta: 'Go Pro',
    popular: false,
  },
  {
    id: 'business',
    name: 'Business',
    price: '$499',
    period: '/mo per store',
    description: 'Fleet analytics, SSO',
    features: ['Up to 50 stores', 'All AI agents', 'Fleet analytics', 'SSO / SAML', 'White-label', 'Dedicated support'],
    cta: 'Contact Sales',
    popular: false,
  },
];

export function OnboardingPage() {
  const { user, session, tenant, refreshMemberships } = useAuth();
  const [step, setStep] = useState<OnboardingStep>('verify-email');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [storeCount, setStoreCount] = useState(1);
  const [industry, setIndustry] = useState('convenience');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [country, setCountry] = useState('US');
  const [setupDone, setSetupDone] = useState(false);
  const [completionError, setCompletionError] = useState('');

  async function completeOnboarding(input?: {
    companyName?: string;
    storeName?: string;
    storeCount?: number;
    industry?: string;
    phone?: string;
    address?: Record<string, string>;
  }) {
    if (tenant?.id) {
      const res = await fetch(`${API_BASE}/api/onboarding/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          tenantId: tenant.id,
          companyName: input?.companyName || companyName || tenant.name,
          storeName: input?.storeName || storeName || tenant.name,
          storeCount: input?.storeCount ?? storeCount,
          industry: input?.industry || industry,
          phone: input?.phone || phone,
          address: input?.address || { street: address, city, state, zip, country },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not complete onboarding. Please try again.');
      }

      await refreshMemberships();
    }

    localStorage.setItem('aros-onboarding-complete', 'true');
    sessionStorage.setItem('aros-onboarding-complete', 'true');
  }

  // Check URL params for payment callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      setStep('business-setup');
    }
    if (params.get('payment') === 'canceled') {
      setStep('choose-plan');
    }
  }, []);

  // Skip verification if email already confirmed
  useEffect(() => {
    if (step !== 'verify-email') return;
    if (user?.email_confirmed_at || user?.user_metadata?.email_verified) {
      setStep('choose-plan');
      return;
    }
    if (!otpSent && user?.email) {
      sendVerificationCode();
    }
  }, [step, user]);

  async function sendVerificationCode() {
    setLoading(true);
    setOtpError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/email-otp/send-verification-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, type: 'email-verification' }),
        credentials: 'include',
      });
      if (res.ok) {
        setOtpSent(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setOtpError(data.error || 'Failed to send verification code. Please try again.');
      }
    } catch {
      setOtpError('Could not reach server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    setOtpError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/email-otp/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, otp }),
        credentials: 'include',
      });
      if (res.ok) {
        setStep('choose-plan');
      } else {
        setOtpError('Invalid code. Please try again.');
      }
    } catch {
      setOtpError('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePlanSelect(planId: string) {
    setSelectedPlan(planId);
    setCompletionError('');

    if (planId === 'free') {
      setLoading(true);
      try {
        await completeOnboarding({
          companyName: tenant?.name || user?.user_metadata?.company || 'My Store',
          storeName: tenant?.name || user?.user_metadata?.company || 'My Store',
          storeCount: 1,
          industry: 'convenience',
        });
        window.location.href = '/dashboard';
      } catch (err) {
        setCompletionError(err instanceof Error ? err.message : 'Could not complete onboarding. Please try again.');
        setLoading(false);
      }
      return;
    }

    if (planId === 'business') {
      // Enterprise — contact sales
      window.location.href = 'https://nirtek.net/support.html#contact';
      return;
    }

    // Paid plan — create Stripe checkout via AROS billing API
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: tenant?.id,
          plan: planId,
          email: user?.email,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setStep('business-setup');
      }
    } catch {
      // Stripe not available — proceed to setup
      setStep('business-setup');
    } finally {
      setLoading(false);
    }
  }

  async function handleBusinessSetup(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setCompletionError('');

    try {
      await completeOnboarding({
        companyName: companyName || tenant?.name,
        storeName,
        storeCount,
        industry,
        phone,
        address: { street: address, city, state, zip, country },
      });
      setSetupDone(true);
      setStep('complete');
    } catch (err) {
      setCompletionError(err instanceof Error ? err.message : 'Could not complete onboarding. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const stepIndex = ['verify-email', 'choose-plan', 'payment', 'business-setup', 'complete'].indexOf(step);

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logo}>AROS</div>
          <p style={styles.tagline}>Let's set up your store</p>
        </div>

        {/* Progress */}
        {step !== 'complete' && (
          <div style={styles.progress}>
            {['Verify Email', 'Choose Plan', 'Setup Business'].map((label, i) => (
              <div key={label} style={styles.progressStep}>
                <div style={{
                  ...styles.progressDot,
                  background: i <= (stepIndex > 2 ? 2 : stepIndex) ? '#3b5bdb' : '#e5e7eb',
                  color: i <= (stepIndex > 2 ? 2 : stepIndex) ? '#fff' : '#9ca3af',
                }}>
                  {i < (stepIndex > 2 ? 3 : stepIndex) ? '✓' : i + 1}
                </div>
                <span style={{
                  fontSize: 12,
                  color: i <= (stepIndex > 2 ? 2 : stepIndex) ? '#1a1a2e' : '#9ca3af',
                  fontWeight: i === (stepIndex > 2 ? 2 : stepIndex) ? 700 : 400,
                }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Step: Verify Email */}
        {step === 'verify-email' && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Verify your email</h2>
            <p style={styles.cardDesc}>
              We sent a verification code to <strong>{user?.email}</strong>
            </p>
            <form onSubmit={verifyOtp} style={styles.form}>
              <input
                type="text"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="Enter 8-digit code"
                maxLength={8}
                required
                style={{ ...styles.input, textAlign: 'center', fontSize: 24, letterSpacing: 8 }}
                autoFocus
              />
              {otpError && <div style={styles.error}>{otpError}</div>}
              <button type="submit" disabled={loading || otp.length < 8} style={styles.button}>
                {loading ? 'Verifying...' : 'Verify Email'}
              </button>
              <button
                type="button"
                onClick={sendVerificationCode}
                disabled={loading}
                style={styles.linkBtn}
              >
                Resend code
              </button>
            </form>
          </div>
        )}

        {/* Step: Choose Plan */}
        {step === 'choose-plan' && (
          <div>
            <h2 style={{ textAlign: 'center', fontSize: 24, fontWeight: 800, marginBottom: 8, color: '#1a1a2e' }}>
              Choose your plan
            </h2>
            <p style={{ textAlign: 'center', fontSize: 14, color: '#6b7280', marginBottom: 32 }}>
              Start free or go managed. Upgrade anytime.
            </p>
            {completionError && <div style={{ ...styles.error, marginBottom: 16 }}>{completionError}</div>}
            <div style={styles.planGrid}>
              {PLANS.map(plan => (
                <div
                  key={plan.id}
                  style={{
                    ...styles.planCard,
                    border: plan.popular ? '2px solid #3b5bdb' : '1px solid #e5e7eb',
                  }}
                >
                  {plan.popular && (
                    <div style={styles.popularBadge}>Most Popular</div>
                  )}
                  <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{plan.name}</h3>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 32, fontWeight: 800 }}>{plan.price}</span>
                    <span style={{ fontSize: 13, color: '#6b7280' }}>{plan.period}</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>{plan.description}</p>
                  <ul style={styles.featureList}>
                    {plan.features.map(f => (
                      <li key={f} style={styles.featureItem}>
                        <span style={{ color: '#059669', marginRight: 6 }}>✓</span> {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => handlePlanSelect(plan.id)}
                    disabled={loading}
                    style={{
                      ...styles.button,
                      background: plan.popular ? '#3b5bdb' : '#f3f4f6',
                      color: plan.popular ? '#fff' : '#374151',
                      marginTop: 'auto',
                    }}
                  >
                    {loading && selectedPlan === plan.id ? 'Processing...' : plan.cta}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step: Business Setup */}
        {step === 'business-setup' && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Set up your business</h2>
            <p style={styles.cardDesc}>Tell us about your store so we can configure AROS for you.</p>
            <form onSubmit={handleBusinessSetup} style={styles.form}>
              <div style={styles.field}>
                <label style={styles.label}>Company Name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="Smith's Corner Market"
                  required
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>First Store Name</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={e => setStoreName(e.target.value)}
                  placeholder="Main Street Location"
                  required
                  style={styles.input}
                />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ ...styles.field, flex: 1 }}>
                  <label style={styles.label}>Industry</label>
                  <select
                    value={industry}
                    onChange={e => setIndustry(e.target.value)}
                    style={styles.input}
                  >
                    <option value="convenience">Convenience Store</option>
                    <option value="grocery">Grocery</option>
                    <option value="liquor">Liquor Store</option>
                    <option value="tobacco">Tobacco & Vape</option>
                    <option value="qsr">QSR / Restaurant</option>
                    <option value="gas">Gas Station</option>
                    <option value="cannabis">Cannabis</option>
                    <option value="franchise">Franchise</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div style={{ ...styles.field, flex: 1 }}>
                  <label style={styles.label}>Number of Stores</label>
                  <input
                    type="number"
                    value={storeCount}
                    onChange={e => setStoreCount(Math.max(1, parseInt(e.target.value) || 1))}
                    min={1}
                    style={styles.input}
                  />
                </div>
              </div>

              {/* Contact */}
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, marginTop: 4 }}>
                <label style={{ ...styles.label, fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'block' }}>Contact Information</label>
                <div style={styles.field}>
                  <label style={styles.label}>Phone Number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    required
                    style={styles.input}
                  />
                </div>
              </div>

              {/* Address */}
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, marginTop: 4 }}>
                <label style={{ ...styles.label, fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'block' }}>Business Address</label>
                <div style={styles.field}>
                  <label style={styles.label}>Street Address</label>
                  <input
                    type="text"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="123 Main Street"
                    required
                    style={styles.input}
                  />
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <div style={{ ...styles.field, flex: 2, minWidth: 0 }}>
                    <label style={styles.label}>City</label>
                    <input
                      type="text"
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      placeholder="Springfield"
                      required
                      style={{ ...styles.input, width: '100%', boxSizing: 'border-box' as const }}
                    />
                  </div>
                  <div style={{ ...styles.field, flex: 1, minWidth: 0 }}>
                    <label style={styles.label}>State</label>
                    <input
                      type="text"
                      value={state}
                      onChange={e => setState(e.target.value.toUpperCase().slice(0, 2))}
                      placeholder="IL"
                      maxLength={2}
                      required
                      style={{ ...styles.input, width: '100%', boxSizing: 'border-box' as const }}
                    />
                  </div>
                  <div style={{ ...styles.field, flex: 1, minWidth: 0 }}>
                    <label style={styles.label}>ZIP</label>
                    <input
                      type="text"
                      value={zip}
                      onChange={e => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                      placeholder="62704"
                      maxLength={5}
                      required
                      style={{ ...styles.input, width: '100%', boxSizing: 'border-box' as const }}
                    />
                  </div>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Country</label>
                  <select
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                    style={styles.input}
                  >
                    <option value="US">United States</option>
                    <option value="CA">Canada</option>
                    <option value="GB">United Kingdom</option>
                    <option value="AU">Australia</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              {(() => {
                const digits = phone.replace(/\D/g, '');
                if (phone && (digits.length < 10 || digits.length > 15)) {
                  return <div style={styles.error}>Please enter a valid phone number (10+ digits)</div>;
                }
                return null;
              })()}
              {completionError && <div style={styles.error}>{completionError}</div>}

              <button type="submit" disabled={loading} style={styles.button}>
                {loading ? 'Setting up...' : 'Launch AROS'}
              </button>
            </form>
          </div>
        )}

        {/* Step: Complete */}
        {step === 'complete' && (
          <div style={{ ...styles.card, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
            <h2 style={styles.cardTitle}>You're all set!</h2>
            <p style={styles.cardDesc}>
              Your AI agents are being configured. {companyName || 'Your store'} will be ready in moments.
              Connect your POS or back-office next so they work with real numbers.
            </p>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => { window.location.href = '/connect'; }}
                style={styles.button}
              >
                Connect Your Store
              </button>
              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                style={{ ...styles.button, background: '#f3f4f6', color: '#374151' }}
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
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
    alignItems: 'flex-start',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #f0f4ff 0%, #e8ecf8 50%, #f5f3ff 100%)',
    padding: '48px 24px',
  },
  container: {
    width: '100%',
    maxWidth: 900,
  },
  header: {
    textAlign: 'center' as const,
    marginBottom: 24,
  },
  logo: {
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: -1,
    color: '#1a1a2e',
  },
  tagline: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  progress: {
    display: 'flex',
    justifyContent: 'center',
    gap: 48,
    marginBottom: 36,
  },
  progressStep: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 6,
  },
  progressDot: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '36px 32px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    border: '1px solid #e5e7eb',
    maxWidth: 480,
    margin: '0 auto',
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: 800,
    color: '#1a1a2e',
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 24,
    lineHeight: 1.5,
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
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: '#3b5bdb',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  planGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
  },
  planCard: {
    background: '#fff',
    borderRadius: 16,
    padding: '24px 20px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    display: 'flex',
    flexDirection: 'column' as const,
    position: 'relative' as const,
  },
  popularBadge: {
    position: 'absolute' as const,
    top: -10,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#3b5bdb',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    padding: '4px 12px',
    borderRadius: 100,
    whiteSpace: 'nowrap' as const,
  },
  featureList: {
    listStyle: 'none',
    padding: 0,
    margin: '0 0 16px 0',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    flex: 1,
  },
  featureItem: {
    fontSize: 13,
    color: '#374151',
  },
  legal: {
    textAlign: 'center' as const,
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 24,
  },
  link: {
    color: '#3b5bdb',
    textDecoration: 'none',
    fontWeight: 600,
  },
};
