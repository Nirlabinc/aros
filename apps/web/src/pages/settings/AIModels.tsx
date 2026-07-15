/**
 * AI Models Settings — BYOM configuration UI
 * Users enter their own API keys. Keys stored locally in models.config.json.
 * AROS never transmits keys to any external server.
 */
import React, { useState, useEffect } from 'react';
import { DEFAULT_MODEL } from '../../model-defaults';

interface ModelProvider {
  id: string;
  provider: 'openai' | 'anthropic' | 'google' | 'ollama' | 'aum' | 'custom';
  label: string;
  model: string;
  apiKey?: string;
  endpoint?: string;
  isActive: boolean;
}

const PROVIDER_PRESETS = [
  { provider: 'anthropic' as const, label: 'Anthropic Claude', placeholder: 'sk-ant-...', defaultModel: 'claude-sonnet-4-6', docs: 'https://console.anthropic.com' },
  { provider: 'openai' as const, label: 'OpenAI', placeholder: 'sk-...', defaultModel: 'gpt-4o', docs: 'https://platform.openai.com/api-keys' },
  { provider: 'google' as const, label: 'Google Gemini', placeholder: 'AIza...', defaultModel: 'gemini-2.5-flash', docs: 'https://aistudio.google.com' },
  { provider: 'ollama' as const, label: 'Ollama (local)', placeholder: 'No key needed', defaultModel: 'llama3.2', docs: 'https://ollama.ai' },
  { provider: 'custom' as const, label: 'Custom (OpenAI-compatible)', placeholder: 'API key (optional)', defaultModel: '', docs: '' },
];

const LOCAL_DEFAULT: ModelProvider = {
  id: 'local-default',
  provider: 'aum',
  label: DEFAULT_MODEL.label,
  model: DEFAULT_MODEL.id,
  endpoint: DEFAULT_MODEL.endpoint,
  isActive: true,
};

export default function AIModelsSettings() {
  const [providers, setProviders] = useState<ModelProvider[]>([LOCAL_DEFAULT]);
  const [activeId, setActiveId] = useState<string>(LOCAL_DEFAULT.id);
  const [adding, setAdding] = useState(false);
  const [newProvider, setNewProvider] = useState<string>('anthropic');
  const [newKey, setNewKey] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newEndpoint, setNewEndpoint] = useState('');
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings/models')
      .then(r => r.json())
      .then(d => {
        const configured = d.providers?.length ? d.providers : [LOCAL_DEFAULT];
        setProviders(configured);
        setActiveId(d.active || configured[0].id);
      })
      .catch(() => { /* Local model remains the safe default. */ });
  }, []);

  async function save(updated: ModelProvider[], active: string) {
    await fetch('/api/settings/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providers: updated, active }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function addProvider() {
    const preset = PROVIDER_PRESETS.find(p => p.provider === newProvider)!;
    const id = `${newProvider}-${Date.now()}`;
    const entry: ModelProvider = {
      id,
      provider: newProvider as ModelProvider['provider'],
      label: preset.label,
      model: newModel || preset.defaultModel,
      apiKey: newKey || undefined,
      endpoint: newEndpoint || (newProvider === 'ollama' ? 'http://localhost:11434' : undefined),
      isActive: providers.length === 0,
    };
    const updated = [...providers, entry];
    const active = providers.length === 0 ? id : activeId;
    setProviders(updated);
    setActiveId(active);
    save(updated, active);
    setAdding(false);
    setNewKey('');
    setNewModel('');
    setNewEndpoint('');
  }

  function removeProvider(id: string) {
    const updated = providers.filter(p => p.id !== id);
    const active = activeId === id ? (updated[0]?.id || '') : activeId;
    setProviders(updated);
    setActiveId(active);
    save(updated, active);
  }

  function setActive(id: string) {
    setActiveId(id);
    save(providers, id);
  }

  const preset = PROVIDER_PRESETS.find(p => p.provider === newProvider)!;

  return (
    <div style={{ maxWidth: 640, padding: '24px' }}>
      <h2 style={{ color: '#e2e8f0', marginBottom: 4 }}>AI Models</h2>
      <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>
        Local inference is the default. You can opt into Claude, ChatGPT, Gemini, or another provider for this workspace.
      </p>

      {providers.length === 0 && (
        <div style={{ padding: '16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, marginBottom: 20, color: '#fca5a5', fontSize: 13 }}>
          ⚠️ No model configured — AROS AI will not function until you add a provider.
        </div>
      )}

      {providers.map(p => (
        <div key={p.id} style={{ background: 'rgba(30,41,59,0.8)', border: `1px solid ${p.id === activeId ? 'rgba(99,102,241,0.5)' : 'rgba(99,102,241,0.15)'}`, borderRadius: 10, padding: '14px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>{p.label}</div>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{p.model}{p.endpoint ? ` · ${p.endpoint}` : ''}</div>
            {p.apiKey && (
              <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4, fontFamily: 'monospace' }}>
                {showKey[p.id] ? p.apiKey : p.apiKey.slice(0, 8) + '••••••••'}
                <button
                  onClick={() => setShowKey(s => ({ ...s, [p.id]: !s[p.id] }))}
                  style={{ marginLeft: 6, background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 11 }}
                >
                  {showKey[p.id] ? 'hide' : 'show'}
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => setActive(p.id)}
            style={{ background: p.id === activeId ? 'linear-gradient(135deg,#4f46e5,#6366f1)' : 'rgba(30,41,59,0.5)', color: p.id === activeId ? '#fff' : '#64748b', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            {p.id === activeId ? '✓ Active' : 'Set Active'}
          </button>
          <button
            onClick={() => removeProvider(p.id)}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 }}
            title="Remove"
          >✕</button>
        </div>
      ))}

      {adding ? (
        <div style={{ background: 'rgba(30,41,59,0.9)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 10, padding: 18, marginBottom: 10 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Provider</label>
            <select
              value={newProvider}
              onChange={e => setNewProvider(e.target.value)}
              style={{ width: '100%', background: 'rgba(15,23,42,0.8)', color: '#e2e8f0', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '7px 10px', fontSize: 13 }}
            >
              {PROVIDER_PRESETS.map(p => <option key={p.provider} value={p.provider}>{p.label}</option>)}
            </select>
          </div>
          {newProvider !== 'ollama' && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>
                API Key {preset.docs && <a href={preset.docs} target="_blank" rel="noopener noreferrer" style={{ color: '#6366f1', marginLeft: 6 }}>Get key ↗</a>}
              </label>
              <input
                type="password"
                value={newKey}
                onChange={e => setNewKey(e.target.value)}
                placeholder={preset.placeholder}
                style={{ width: '100%', background: 'rgba(15,23,42,0.8)', color: '#e2e8f0', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
          )}
          {(newProvider === 'ollama' || newProvider === 'custom') && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Endpoint URL</label>
              <input
                value={newEndpoint}
                onChange={e => setNewEndpoint(e.target.value)}
                placeholder={newProvider === 'ollama' ? 'http://localhost:11434' : 'https://your-endpoint/v1'}
                style={{ width: '100%', background: 'rgba(15,23,42,0.8)', color: '#e2e8f0', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Model</label>
            <input
              value={newModel}
              onChange={e => setNewModel(e.target.value)}
              placeholder={preset.defaultModel}
              style={{ width: '100%', background: 'rgba(15,23,42,0.8)', color: '#e2e8f0', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={addProvider}
              style={{ background: 'linear-gradient(135deg,#4f46e5,#6366f1)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >Add Provider</button>
            <button
              onClick={() => setAdding(false)}
              style={{ background: 'none', border: '1px solid rgba(99,102,241,0.2)', color: '#94a3b8', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}
            >Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{ background: 'rgba(30,41,59,0.6)', border: '1px dashed rgba(99,102,241,0.3)', color: '#6366f1', borderRadius: 10, padding: '12px 20px', fontSize: 13, cursor: 'pointer', width: '100%' }}
        >
          + Add Model Provider
        </button>
      )}

      {saved && <div style={{ marginTop: 12, color: '#4ade80', fontSize: 13 }}>✓ Saved</div>}

      <div style={{ marginTop: 24, padding: '12px 16px', background: 'rgba(15,23,42,0.5)', borderRadius: 8, color: '#475569', fontSize: 12, lineHeight: 1.6 }}>
        🔒 API keys are stored locally in <code>models.config.json</code> on your machine.<br />
        They are never sent to Nirlab, AROS servers, or any third party.
      </div>
    </div>
  );
}
