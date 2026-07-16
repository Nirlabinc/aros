import { useState } from 'react';
import { PROVIDER_PRESETS, presetFor, RECOMMENDED_MODEL } from '../../model-catalog';
import type { ModelChoice, ByomEntry } from '../../onboarding/api';

/**
 * Model setup — step 2 of the journey. Offers the AROS-managed recommended
 * default (preselected, zero-config) and an optional "bring your own model"
 * path that reuses the shared provider catalog (no duplicate provider list).
 */
export function ModelSetupStep({ busy, onSubmit }: {
  busy: boolean;
  onSubmit: (choice: ModelChoice, byom?: ByomEntry) => void;
}) {
  const [mode, setMode] = useState<'recommended' | 'byom'>('recommended');
  const [provider, setProvider] = useState<string>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [error, setError] = useState('');

  const preset = presetFor(provider);

  function submit() {
    setError('');
    if (mode === 'recommended') {
      onSubmit({ mode: 'recommended', label: RECOMMENDED_MODEL.label });
      return;
    }
    if (preset.needsKey && !apiKey.trim()) {
      setError(`An API key is required for ${preset.label}.`);
      return;
    }
    const resolvedModel = model.trim() || preset.defaultModel;
    const entry: ByomEntry = {
      id: `${provider}-onboarding`,
      provider,
      label: preset.label,
      model: resolvedModel,
      apiKey: apiKey.trim() || undefined,
      endpoint: endpoint.trim() || (provider === 'ollama' ? 'http://localhost:11434' : undefined),
      isActive: true,
    };
    onSubmit(
      { mode: 'byom', provider, model: resolvedModel, label: `${preset.label}${resolvedModel ? ` · ${resolvedModel}` : ''}` },
      entry,
    );
  }

  return (
    <div style={s.card}>
      <h2 style={s.title}>Choose your AI model</h2>
      <p style={s.desc}>Your agents run on this model. Start with the AROS-managed default — you can change it anytime in settings.</p>

      <button
        type="button"
        onClick={() => setMode('recommended')}
        style={{ ...s.option, ...(mode === 'recommended' ? s.optionActive : {}) }}
      >
        <div style={s.optionHead}>
          <span style={s.optionTitle}>{RECOMMENDED_MODEL.label}</span>
          <span style={s.badge}>Recommended</span>
        </div>
        <span style={s.optionSub}>{RECOMMENDED_MODEL.tagline}</span>
      </button>

      <button
        type="button"
        onClick={() => setMode('byom')}
        style={{ ...s.option, ...(mode === 'byom' ? s.optionActive : {}) }}
      >
        <div style={s.optionHead}>
          <span style={s.optionTitle}>Bring your own model</span>
        </div>
        <span style={s.optionSub}>Use your own Anthropic, OpenAI, Gemini, Ollama, or custom endpoint. Your key stays in your workspace.</span>
      </button>

      {mode === 'byom' && (
        <div style={s.byom}>
          <div style={s.field}>
            <label style={s.label}>Provider</label>
            <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); setEndpoint(''); }} style={s.input}>
              {PROVIDER_PRESETS.map((p) => <option key={p.provider} value={p.provider}>{p.label}</option>)}
            </select>
          </div>
          {preset.needsKey && (
            <div style={s.field}>
              <label style={s.label}>
                API key {preset.docs && <a href={preset.docs} target="_blank" rel="noopener noreferrer" style={s.link}>Get key ↗</a>}
              </label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={preset.placeholder} autoComplete="off" style={s.input} />
            </div>
          )}
          {(provider === 'ollama' || provider === 'custom') && (
            <div style={s.field}>
              <label style={s.label}>Endpoint URL</label>
              <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://your-endpoint/v1'} style={s.input} />
            </div>
          )}
          <div style={s.field}>
            <label style={s.label}>Model</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={preset.defaultModel || 'model name'} style={s.input} />
          </div>
          <div style={s.note}>🔒 Keys are stored by your local models sidecar and are never sent to AROS servers.</div>
        </div>
      )}

      {error && <div style={s.error}>{error}</div>}

      <button type="button" onClick={submit} disabled={busy} style={s.primary}>
        {busy ? 'Saving…' : 'Continue'}
      </button>
    </div>
  );
}

const ACCENT = '#3b5bdb';
const s: Record<string, React.CSSProperties> = {
  card: { background: '#fff', borderRadius: 16, padding: '32px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e5e7eb', maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 },
  title: { fontSize: 22, fontWeight: 800, color: '#1a1a2e', margin: 0 },
  desc: { fontSize: 14, color: '#6b7280', margin: '0 0 4px', lineHeight: 1.5 },
  option: { textAlign: 'left', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 6 },
  optionActive: { border: `2px solid ${ACCENT}`, background: '#f0f4ff', padding: '15px 17px' },
  optionHead: { display: 'flex', alignItems: 'center', gap: 10 },
  optionTitle: { fontSize: 15, fontWeight: 700, color: '#1a1a2e' },
  optionSub: { fontSize: 13, color: '#6b7280', lineHeight: 1.45 },
  badge: { marginLeft: 'auto', background: ACCENT, color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 100 },
  byom: { display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid #f3f4f6', paddingTop: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 13, fontWeight: 600, color: '#374151' },
  input: { padding: '11px 13px', border: '1px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none' },
  link: { color: ACCENT, fontWeight: 600, marginLeft: 6, textDecoration: 'none' },
  note: { fontSize: 12, color: '#6b7280', background: '#f9fafb', borderRadius: 8, padding: '10px 12px', lineHeight: 1.5 },
  error: { padding: '10px 14px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, fontSize: 13, fontWeight: 500 },
  primary: { padding: '14px 0', background: ACCENT, color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 },
};
