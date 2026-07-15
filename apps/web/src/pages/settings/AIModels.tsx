import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { DEFAULT_MODEL } from '../../model-defaults';

type ModelResource = { id: string; name: string; provider: string; status: string; config: { modelId?: string; endpoint?: string; local?: boolean } };

export default function AIModelsSettings() {
  const { session, tenant } = useAuth();
  const [models, setModels] = useState<ModelResource[]>([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const enrollmentToken = sessionStorage.getItem('aros-model-enrollment-token');
  const headers = useMemo(() => ({ Authorization: `Bearer ${session?.access_token || ''}`, 'X-AROS-Tenant-Id': tenant?.id || '' }), [session, tenant]);

  useEffect(() => {
    if (!session?.access_token || !tenant?.id) return;
    fetch('/api/resources/model', { headers }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to load model configuration');
      setModels(body.resources || []);
    }).catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load model configuration'));
  }, [session?.access_token, tenant?.id]);

  const local = models.find(model => model.provider === 'aum') || { name: DEFAULT_MODEL.label, provider: 'aum', status: 'configuring', config: { modelId: DEFAULT_MODEL.id, endpoint: DEFAULT_MODEL.endpoint, local: true } };
  async function copyToken() {
    if (!enrollmentToken) return;
    await navigator.clipboard.writeText(enrollmentToken);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  return <section className="setup-page">
    <header className="setup-header"><div><p className="setup-eyebrow">Models</p><h1>AI models</h1><p>Local AUM access is the workspace default. Device keys live in the local encrypted Shre secrets vault.</p></div></header>
    {error && <div className="test-success" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}><strong>Model status unavailable</strong><span>{error}</span></div>}
    <article className="setup-panel catalog-card"><div className="catalog-card-head"><div className="provider-mark">AU</div><span className={`status-pill ${local.status === 'active' ? 'connected' : 'inactive'}`}>{local.status === 'active' ? 'Active' : 'Enrollment required'}</span></div><h2>{local.name}</h2><p>{local.config.modelId || DEFAULT_MODEL.id} · {local.config.endpoint || DEFAULT_MODEL.endpoint}</p><div className="permission-review"><strong>Credential custody</strong><span>Raw key: local Shre secrets vault only</span><span>Cloud record: alias and SHA-256 fingerprint only</span><span>Enrollment token: single use, expires after 24 hours</span></div></article>
    {enrollmentToken ? <article className="setup-panel" style={{ marginTop: 16 }}><h2>Enroll this computer</h2><p>Run the installer, then paste the one-time token when prompted. The secure prompt keeps it out of shell history.</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>irm https://app.aros.live/setup/enroll-model.ps1 | iex</pre><div className="modal-actions"><button className="setup-secondary" onClick={() => void copyToken()}>{copied ? '✓ Copied' : 'Copy one-time token'}</button><button className="setup-secondary" onClick={() => { sessionStorage.removeItem('aros-model-enrollment-token'); window.location.reload(); }}>Clear token</button></div></article> : <article className="setup-panel" style={{ marginTop: 16 }}><h2>No pending enrollment</h2><p>New accounts receive a one-time enrollment token during signup. Credential rotation for existing owners is not yet available from this screen.</p></article>}
    <article className="setup-panel" style={{ marginTop: 16 }}><h2>Cloud model providers</h2><p>Claude, ChatGPT, Gemini, and custom providers will use provider OAuth or vault-backed credentials. Raw API keys are intentionally not accepted here.</p></article>
  </section>;
}
