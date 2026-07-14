import { useState, type FormEvent } from 'react';
import { useAuth } from '../../admin/useAuth';

const MARKETPLACE_URL = (window as any).__MARKETPLACE_URL__
  ?? (window.location.hostname === 'localhost' ? 'http://localhost:5458' : 'https://marketplace.nirtek.net');

type Step = 'overview' | 'plugin-info' | 'integration' | 'demo-creds' | 'review' | 'submitted';

const CATEGORIES = [
  'pos', 'pos-connector', 'inventory', 'analytics', 'loyalty',
  'marketing', 'payments', 'shipping', 'crm', 'reporting',
  'database', 'integration', 'utility',
];

const STEP_LABELS = ['Overview', 'Plugin Info', 'Integration', 'Demo & Testing', 'Review & Submit'];

const font = '-apple-system, "SF Pro Text", BlinkMacSystemFont, "Helvetica Neue", system-ui, sans-serif';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 13,
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
  color: '#ececf1', fontFamily: font, outline: 'none', boxSizing: 'border-box',
};

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, required, hint, children }: FieldProps) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#a1a1aa', marginBottom: 4 }}>
        {label}{required && <span style={{ color: '#ef4444' }}> *</span>}
      </label>
      {hint && <div style={{ fontSize: 11, color: '#6b6b76', marginBottom: 6 }}>{hint}</div>}
      {children}
    </div>
  );
}

export function DeveloperPortal() {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('overview');

  // Plugin info
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('integration');
  const [changelog, setChangelog] = useState('');

  // Integration
  const [packageName, setPackageName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [entryPoint, setEntryPoint] = useState('');
  const [configFields, setConfigFields] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);

  // Demo
  const [demoUrl, setDemoUrl] = useState('');
  const [demoUser, setDemoUser] = useState('');
  const [demoPass, setDemoPass] = useState('');
  const [demoEnv, setDemoEnv] = useState<'sandbox' | 'staging' | 'production'>('sandbox');
  const [demoInstructions, setDemoInstructions] = useState('');

  // State
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; submissionId?: string } | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const stepIndex = (['overview', 'plugin-info', 'integration', 'demo-creds', 'review'] as Step[]).indexOf(step);

  const PERMISSION_OPTIONS = [
    { id: 'data-read', label: 'Read store data', desc: 'Access transaction, inventory, and customer data' },
    { id: 'data-write', label: 'Write store data', desc: 'Create or modify store records' },
    { id: 'data-sync', label: 'Sync external data', desc: 'Pull data from external APIs' },
    { id: 'analytics', label: 'Analytics access', desc: 'Access reporting and analytics endpoints' },
    { id: 'communication', label: 'Send messages', desc: 'Send emails, Slack, or other notifications' },
    { id: 'file-ops', label: 'File operations', desc: 'Read/write files and cloud storage' },
    { id: 'automation', label: 'Automation', desc: 'Create tasks, schedule actions, trigger workflows' },
  ];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch(`${MARKETPLACE_URL}/api/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, version, description, category, changelog, packageName, sourceUrl,
          entryPoint: entryPoint || undefined,
          configFields: configFields ? configFields.split('\n').filter(Boolean) : undefined,
          permissions,
          submitterId: user?.sub ?? 'anonymous',
          submitterEmail: user?.email ?? 'unknown',
          demoCredentials: {
            url: demoUrl, username: demoUser, password: demoPass,
            environment: demoEnv, instructions: demoInstructions || undefined,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setResult({
          ok: true,
          message: 'Your plugin has been submitted for review.',
          submissionId: data.id || data.submissionId,
        });
        setStep('submitted');
      } else {
        const err = await res.json().catch(() => ({ error: 'Submission failed' }));
        setResult({ ok: false, message: err.error ?? 'Submission failed' });
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Network error' });
    }
    setSubmitting(false);
  }

  const canAdvance: Record<string, boolean> = {
    'overview': true,
    'plugin-info': !!(name.trim() && version.trim() && description.trim()),
    'integration': !!packageName.trim(),
    'demo-creds': !!(demoUrl.trim() && demoUser.trim() && demoPass.trim()),
    'review': agreedToTerms,
  };

  function goNext() {
    const steps: Step[] = ['overview', 'plugin-info', 'integration', 'demo-creds', 'review'];
    const i = steps.indexOf(step);
    if (i < steps.length - 1) setStep(steps[i + 1]);
  }

  function goBack() {
    const steps: Step[] = ['overview', 'plugin-info', 'integration', 'demo-creds', 'review'];
    const i = steps.indexOf(step);
    if (i > 0) setStep(steps[i - 1]);
  }

  return (
    <div style={{ padding: 32, fontFamily: font, color: '#ececf1', maxWidth: 760, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(99,141,255,0.15)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}>
            {'</>'}
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>
            Developer Portal
          </h1>
        </div>
        <p style={{ fontSize: 13, color: '#a1a1aa' }}>
          Build and publish integrations for the AROS marketplace.
        </p>
      </div>

      {/* Progress bar */}
      {step !== 'submitted' && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {STEP_LABELS.map((label, i) => (
              <div key={label} style={{ flex: 1 }}>
                <div style={{
                  height: 3, borderRadius: 2,
                  background: i <= stepIndex ? '#638dff' : 'rgba(255,255,255,0.08)',
                  transition: 'background 200ms',
                }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            {STEP_LABELS.map((label, i) => (
              <span key={label} style={{
                fontSize: 11, fontWeight: i === stepIndex ? 700 : 400,
                color: i <= stepIndex ? '#638dff' : '#6b6b76',
              }}>
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error banner */}
      {result && !result.ok && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 20, fontSize: 13,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)',
          color: '#FCA5A5',
        }}>
          {result.message}
        </div>
      )}

      {/* ── Step: Overview ─────────────────────────────── */}
      {step === 'overview' && (
        <div>
          <div style={cardStyle}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>How it works</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {[
                { num: '1', title: 'Build your integration', desc: 'Create a plugin that connects to AROS via our Node SDK. POS connectors, analytics tools, payment processors — anything that helps retailers.' },
                { num: '2', title: 'Submit for review', desc: 'Provide plugin details, source code, and working demo credentials. Our review team tests every submission — like the App Store.' },
                { num: '3', title: 'Get published', desc: 'Approved plugins go live in the AROS Marketplace. Retailers can install with one click. You earn revenue on paid plugins.' },
              ].map(s => (
                <div key={s.num} style={{ display: 'flex', gap: 14 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: 'rgba(99,141,255,0.15)', color: '#638dff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700,
                  }}>
                    {s.num}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{s.title}</div>
                    <div style={{ fontSize: 13, color: '#a1a1aa', lineHeight: 1.5 }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Requirements */}
          <div style={{ ...cardStyle, marginTop: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#638dff', marginBottom: 12 }}>Requirements</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#a1a1aa', lineHeight: 1.8 }}>
              <li>Working demo environment with test credentials</li>
              <li>Plugin must not require shell access or root permissions</li>
              <li>Must declare all data access permissions upfront</li>
              <li>No tracking, telemetry, or data exfiltration outside declared scope</li>
              <li>Must handle errors gracefully (no crashes, no data loss)</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── Step: Plugin Info ──────────────────────────── */}
      {step === 'plugin-info' && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, color: '#638dff' }}>Plugin Information</h2>
          <Field label="Plugin Name" required hint="The name shown in the marketplace">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="My POS Connector" style={inputStyle} autoFocus />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Version" required hint="Semantic version (e.g. 1.0.0)">
              <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.0.0" style={inputStyle} />
            </Field>
            <Field label="Category" required>
              <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputStyle, appearance: 'auto' as any }}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/-/g, ' ')}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description" required hint="What does your plugin do? (2-3 sentences)">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder="Connects AROS to Acme POS system, enabling real-time transaction sync, inventory management, and sales reporting."
              style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
          <Field label="Changelog" hint="What's new in this version?">
            <textarea value={changelog} onChange={e => setChangelog(e.target.value)} rows={2}
              placeholder="- Initial release&#10;- Real-time transaction sync&#10;- Inventory lookup"
              style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
        </div>
      )}

      {/* ── Step: Integration ─────────────────────────── */}
      {step === 'integration' && (
        <div>
          <div style={cardStyle}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, color: '#638dff' }}>Integration Details</h2>
            <Field label="Package Name" required hint="npm package name or registry identifier">
              <input value={packageName} onChange={e => setPackageName(e.target.value)} placeholder="@acme/pos-connector" style={inputStyle} autoFocus />
            </Field>
            <Field label="Source URL" hint="GitHub, GitLab, or other repository URL">
              <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://github.com/acme/pos-connector" style={inputStyle} />
            </Field>
            <Field label="Entry Point" hint="Main module path (default: index.ts)">
              <input value={entryPoint} onChange={e => setEntryPoint(e.target.value)} placeholder="src/index.ts" style={inputStyle} />
            </Field>
            <Field label="Config Fields" hint="One per line — fields the retailer must configure (e.g. api_key, store_id)">
              <textarea value={configFields} onChange={e => setConfigFields(e.target.value)} rows={3}
                placeholder="api_key&#10;store_id&#10;webhook_url"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }} />
            </Field>
          </div>

          {/* Permissions */}
          <div style={{ ...cardStyle, marginTop: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#638dff', marginBottom: 4 }}>Permissions</h3>
            <div style={{ fontSize: 12, color: '#6b6b76', marginBottom: 16 }}>
              Declare what your plugin needs access to. Retailers see this before installing.
            </div>
            {PERMISSION_OPTIONS.map(p => (
              <label key={p.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12, cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={permissions.includes(p.id)}
                  onChange={e => {
                    if (e.target.checked) setPermissions([...permissions, p.id]);
                    else setPermissions(permissions.filter(x => x !== p.id));
                  }}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: '#6b6b76' }}>{p.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── Step: Demo Credentials ────────────────────── */}
      {step === 'demo-creds' && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#638dff' }}>Demo & Testing</h2>
          <p style={{ fontSize: 12, color: '#6b6b76', marginBottom: 20 }}>
            Provide a working environment where our review team can test your plugin.
            Credentials are stored securely and only used during the review process.
          </p>
          <Field label="Demo URL" required hint="The URL where reviewers can access your plugin">
            <input value={demoUrl} onChange={e => setDemoUrl(e.target.value)} placeholder="https://demo.acme-pos.com" style={inputStyle} autoFocus />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Username" required>
              <input value={demoUser} onChange={e => setDemoUser(e.target.value)} placeholder="demo@acme.com" style={inputStyle} />
            </Field>
            <Field label="Password" required>
              <input value={demoPass} onChange={e => setDemoPass(e.target.value)} type="password" placeholder="demo-password" style={inputStyle} />
            </Field>
          </div>
          <Field label="Environment">
            <select value={demoEnv} onChange={e => setDemoEnv(e.target.value as any)} style={{ ...inputStyle, appearance: 'auto' as any }}>
              <option value="sandbox">Sandbox</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </Field>
          <Field label="Testing Instructions" hint="Step-by-step guide for reviewers">
            <textarea value={demoInstructions} onChange={e => setDemoInstructions(e.target.value)} rows={4}
              placeholder="1. Log in with the credentials above&#10;2. Navigate to Store #1&#10;3. Create a test transaction&#10;4. Verify data appears in AROS dashboard"
              style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
        </div>
      )}

      {/* ── Step: Review ──────────────────────────────── */}
      {step === 'review' && (
        <form onSubmit={handleSubmit}>
          <div style={cardStyle}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, color: '#638dff' }}>Review Your Submission</h2>

            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <SummaryField label="Plugin Name" value={name} />
              <SummaryField label="Version" value={version} />
              <SummaryField label="Category" value={category} />
              <SummaryField label="Package" value={packageName} />
            </div>
            <SummaryField label="Description" value={description} />
            {changelog && <SummaryField label="Changelog" value={changelog} />}
            {sourceUrl && <SummaryField label="Source" value={sourceUrl} />}
            {permissions.length > 0 && <SummaryField label="Permissions" value={permissions.join(', ')} />}

            <div style={{
              marginTop: 16, padding: 12, borderRadius: 10,
              background: 'rgba(99,141,255,0.06)', border: '1px solid rgba(99,141,255,0.1)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#638dff', marginBottom: 4 }}>Demo Environment</div>
              <div style={{ fontSize: 13, color: '#a1a1aa' }}>
                {demoUrl} ({demoEnv}) — {demoUser}
              </div>
            </div>
          </div>

          {/* Terms */}
          <div style={{ ...cardStyle, marginTop: 16 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={e => setAgreedToTerms(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <div style={{ fontSize: 13, color: '#a1a1aa', lineHeight: 1.6 }}>
                I confirm that this plugin does not contain malicious code, respects user data privacy,
                and complies with the{' '}
                <a href="https://nirtek.net/terms.html" target="_blank" rel="noopener" style={{ color: '#638dff' }}>
                  AROS Developer Terms
                </a>.
                I understand that submitted demo credentials are used solely for review purposes.
              </div>
            </label>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={!agreedToTerms || submitting}
            style={{
              width: '100%', padding: '14px 0', borderRadius: 10, border: 'none',
              marginTop: 20, fontSize: 14, fontWeight: 700, fontFamily: font,
              cursor: agreedToTerms && !submitting ? 'pointer' : 'not-allowed',
              background: agreedToTerms && !submitting ? '#638dff' : 'rgba(255,255,255,0.06)',
              color: agreedToTerms && !submitting ? '#fff' : '#6b6b76',
              transition: 'all 150ms',
            }}
          >
            {submitting ? 'Submitting...' : 'Submit for Review'}
          </button>
        </form>
      )}

      {/* ── Step: Submitted ───────────────────────────── */}
      {step === 'submitted' && result?.ok && (
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{'</>  >'}</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Submission Received</h2>
          <p style={{ fontSize: 14, color: '#a1a1aa', lineHeight: 1.6, marginBottom: 8 }}>
            Your plugin <strong style={{ color: '#ececf1' }}>{name}</strong> has been submitted for review.
          </p>
          {result.submissionId && (
            <p style={{ fontSize: 12, color: '#6b6b76', marginBottom: 20 }}>
              Submission ID: <code style={{ color: '#638dff' }}>{result.submissionId}</code>
            </p>
          )}
          <p style={{ fontSize: 13, color: '#6b6b76', lineHeight: 1.6, marginBottom: 24 }}>
            Our review team will test your plugin using the demo credentials provided.
            You'll receive an email notification when the review is complete — typically within 2-3 business days.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={() => window.location.href = '/marketplace'}
              style={{
                padding: '10px 24px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                background: 'transparent', color: '#a1a1aa', fontSize: 13, fontWeight: 600,
                fontFamily: font, cursor: 'pointer',
              }}
            >
              Back to Marketplace
            </button>
            <button
              onClick={() => {
                // Reset form
                setName(''); setVersion('1.0.0'); setDescription(''); setChangelog('');
                setPackageName(''); setSourceUrl(''); setEntryPoint(''); setConfigFields('');
                setPermissions([]); setDemoUrl(''); setDemoUser(''); setDemoPass('');
                setDemoInstructions(''); setAgreedToTerms(false); setResult(null);
                setStep('overview');
              }}
              style={{
                padding: '10px 24px', borderRadius: 10, border: 'none',
                background: '#638dff', color: '#fff', fontSize: 13, fontWeight: 600,
                fontFamily: font, cursor: 'pointer',
              }}
            >
              Submit Another
            </button>
          </div>
        </div>
      )}

      {/* Navigation buttons */}
      {step !== 'submitted' && step !== 'review' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
          {step !== 'overview' ? (
            <button onClick={goBack} style={navBtnStyle}>Back</button>
          ) : (
            <div />
          )}
          <button
            onClick={goNext}
            disabled={!canAdvance[step]}
            style={{
              ...navBtnStyle,
              background: canAdvance[step] ? '#638dff' : 'rgba(255,255,255,0.06)',
              color: canAdvance[step] ? '#fff' : '#6b6b76',
              border: 'none',
            }}
          >
            {step === 'overview' ? 'Start Submission' : 'Continue'}
          </button>
        </div>
      )}

      {step === 'review' && (
        <div style={{ marginTop: 12 }}>
          <button onClick={goBack} style={{ ...navBtnStyle, marginTop: 8 }}>Back to Edit</button>
        </div>
      )}
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b6b76', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#ececf1', whiteSpace: 'pre-wrap' }}>{value || '—'}</div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: 24, borderRadius: 14,
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
};

const navBtnStyle: React.CSSProperties = {
  padding: '10px 28px', borderRadius: 10, fontSize: 13, fontWeight: 600,
  fontFamily: '-apple-system, "SF Pro Text", BlinkMacSystemFont, "Helvetica Neue", system-ui, sans-serif',
  cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)',
  background: 'transparent', color: '#a1a1aa', transition: 'all 150ms',
};
