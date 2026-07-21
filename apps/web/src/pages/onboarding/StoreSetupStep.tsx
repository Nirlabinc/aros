import { useMemo, useState, type FormEvent } from 'react';
import { WIZARD_PROVIDERS, type ProviderDef } from '../../lib/posProviders';
import type { AuthScope } from '../../onboarding/api';

const API_BASE = (window as unknown as { __AROS_API_URL__?: string }).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

type StoreStage = 'select-pos' | 'setup-store' | 'saved';

interface StoreDraft {
  localId: string;
  name: string;
  provider: ProviderDef | null;
  values: Record<string, string>;
  showSecrets: Record<string, boolean>;
  stage: StoreStage;
  connectorId?: string;
  activation?: { code: string; expiresAt?: string };
  error?: string;
}

interface StoreSetupStepProps {
  auth: AuthScope;
  busy?: boolean;
  onSaved?: () => Promise<void> | void;
  onContinue: () => Promise<void> | void;
  onSkip: () => Promise<void> | void;
}

function newStoreDraft(index: number): StoreDraft {
  return {
    localId: `store-${Date.now()}-${index}`,
    name: index === 1 ? 'Main store' : `Store ${index}`,
    provider: null,
    values: {},
    showSecrets: {},
    stage: 'select-pos',
  };
}

function headers(auth: AuthScope): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
    ...(auth.tenantId ? { 'x-aros-tenant-id': auth.tenantId } : {}),
  };
}

export function StoreSetupStep({ auth, busy = false, onSaved, onContinue, onSkip }: StoreSetupStepProps) {
  const [stores, setStores] = useState<StoreDraft[]>(() => [newStoreDraft(1)]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const activeStore = stores[activeIndex];
  const savedCount = useMemo(() => stores.filter((store) => store.stage === 'saved').length, [stores]);

  function updateActive(patch: Partial<StoreDraft>) {
    setStores((current) => current.map((store, index) => (
      index === activeIndex ? { ...store, ...patch } : store
    )));
  }

  function updateValue(key: string, value: string) {
    setStores((current) => current.map((store, index) => (
      index === activeIndex
        ? { ...store, values: { ...store.values, [key]: value }, error: '' }
        : store
    )));
  }

  function toggleSecret(key: string) {
    setStores((current) => current.map((store, index) => (
      index === activeIndex
        ? { ...store, showSecrets: { ...store.showSecrets, [key]: !store.showSecrets[key] } }
        : store
    )));
  }

  function addStore() {
    setStores((current) => {
      const next = [...current, newStoreDraft(current.length + 1)];
      setActiveIndex(next.length - 1);
      return next;
    });
  }

  async function saveStore(event: FormEvent) {
    event.preventDefault();
    if (!activeStore?.provider || saving) return;

    const config: Record<string, unknown> = { storeName: activeStore.name.trim() };
    const secrets: Record<string, string> = {};

    for (const field of activeStore.provider.fields) {
      const value = (activeStore.values[field.key] || '').trim();
      if (!value && !field.optional) {
        updateActive({ error: `${field.label} is required.` });
        return;
      }
      if (!value) continue;
      if (field.secret) secrets[field.key] = value;
      else config[field.key] = field.key === 'port' ? Number(value) : value;
    }

    setSaving(true);
    updateActive({ error: '' });
    try {
      const response = await fetch(`${API_BASE}/api/connectors`, {
        method: 'POST',
        headers: headers(auth),
        body: JSON.stringify({
          type: activeStore.provider.id,
          name: activeStore.name.trim() || `${activeStore.provider.shortName} connection`,
          config,
          secrets,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save this store setup.');
      updateActive({
        stage: 'saved',
        connectorId: data.connector?.id,
        activation: data.edgeActivation
          ? { code: data.edgeActivation.activationCode, expiresAt: data.edgeActivation.expiresAt }
          : undefined,
        error: '',
      });
      await onSaved?.();
    } catch (error) {
      updateActive({ error: error instanceof Error ? error.message : 'Could not save this store setup.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={s.card}>
      <div style={s.head}>
        <div>
          <h2 style={s.cardTitle}>Set up each store</h2>
          <p style={s.cardDesc}>Select the POS for one store, set up that store, then add the next one.</p>
        </div>
        <div style={s.count}>{savedCount}/{stores.length} saved</div>
      </div>

      <div style={s.layout}>
        <aside style={s.rail}>
          {stores.map((store, index) => (
            <button
              key={store.localId}
              type="button"
              onClick={() => setActiveIndex(index)}
              style={{
                ...s.railItem,
                borderColor: index === activeIndex ? '#3b5bdb' : '#e5e7eb',
                background: index === activeIndex ? '#f0f4ff' : '#fff',
              }}
            >
              <span style={s.railTitle}>{store.name || `Store ${index + 1}`}</span>
              <span style={s.railMeta}>{store.stage === 'saved' ? 'Saved' : store.provider?.shortName || 'Select POS'}</span>
            </button>
          ))}
          <button type="button" onClick={addStore} style={s.addStore}>Add more store</button>
        </aside>

        <section style={s.panel}>
          <div style={s.group}>
            <div style={s.groupTitle}>Store name</div>
            <input
              value={activeStore.name}
              onChange={(event) => updateActive({ name: event.target.value, error: '' })}
              placeholder="Main Street Location"
              style={s.input}
            />
          </div>

          {activeStore.stage === 'select-pos' && (
            <div style={s.group}>
              <div style={s.groupTitle}>Select POS</div>
              <div style={s.providerGrid}>
                {WIZARD_PROVIDERS.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => updateActive({ provider, values: {}, showSecrets: {}, stage: 'setup-store', error: '' })}
                    style={s.providerCard}
                  >
                    <span style={s.providerMark}>{provider.mark}</span>
                    <strong>{provider.shortName}</strong>
                    <small>{provider.tagline}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeStore.stage === 'setup-store' && activeStore.provider && (
            <form onSubmit={saveStore} style={s.form}>
              <div style={s.group}>
                <div style={s.groupTitle}>Setup the store</div>
                <p style={s.copy}>{activeStore.provider.blurb}</p>
                {activeStore.provider.fields.map((field) => {
                  const isPassword = field.secret && field.key !== 'email';
                  return (
                    <label key={field.key} style={s.field}>
                      <span style={s.label}>{field.label}{field.optional ? ' (optional)' : ''}</span>
                      <span style={s.secretRow}>
                        <input
                          type={isPassword && !activeStore.showSecrets[field.key] ? 'password' : field.key === 'email' ? 'email' : 'text'}
                          value={activeStore.values[field.key] || ''}
                          onChange={(event) => updateValue(field.key, event.target.value)}
                          placeholder={field.placeholder}
                          autoComplete={field.key === 'email' ? 'username' : isPassword ? 'current-password' : 'off'}
                          style={{ ...s.input, flex: 1 }}
                        />
                        {isPassword && (
                          <button type="button" onClick={() => toggleSecret(field.key)} style={s.secondaryButton}>
                            {activeStore.showSecrets[field.key] ? 'Hide' : 'Show'}
                          </button>
                        )}
                      </span>
                      {field.hint && <span style={s.hint}>{field.hint}</span>}
                    </label>
                  );
                })}
              </div>
              {activeStore.error && <div style={s.error}>{activeStore.error}</div>}
              <div style={s.actions}>
                <button type="submit" disabled={saving || busy || !activeStore.name.trim()} style={{ ...s.primary, flex: 1 }}>
                  {saving ? 'Saving...' : 'Save store setup'}
                </button>
                <button type="button" onClick={() => updateActive({ provider: null, values: {}, showSecrets: {}, stage: 'select-pos', error: '' })} style={{ ...s.secondary, flex: 1 }}>
                  Select POS
                </button>
              </div>
            </form>
          )}

          {activeStore.stage === 'saved' && (
            <div style={s.savedPane}>
              <div style={s.success}>
                <strong>Store setup saved</strong>
                <span>{activeStore.name} is mapped to {activeStore.provider?.shortName || 'a POS connection'}.</span>
              </div>
              {activeStore.activation && (
                <>
                  <div style={s.activationBox}>
                    <span>Activation code</span>
                    <strong>{activeStore.activation.code}</strong>
                  </div>
                  <ol style={s.steps}>
                    <li>Open the Edge Relay installer on the store computer.</li>
                    <li>Paste the activation code to link that computer to {activeStore.name}.</li>
                    <li>Validate a closed business period before automatic sync begins.</li>
                  </ol>
                </>
              )}
              <div style={s.actions}>
                <button type="button" onClick={addStore} style={{ ...s.primary, flex: 1 }}>Add more store</button>
                <button type="button" onClick={() => void onContinue()} disabled={busy} style={{ ...s.secondary, flex: 1 }}>
                  {busy ? 'Saving...' : 'Review setup'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <div style={s.footerActions}>
        <button type="button" onClick={() => void onSkip()} disabled={busy || saving} style={s.secondary}>
          {busy ? 'Skipping...' : 'Skip for now'}
        </button>
      </div>
    </div>
  );
}

const ACCENT = '#3b5bdb';
const s: Record<string, React.CSSProperties> = {
  card: { background: '#fff', borderRadius: 16, padding: '28px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e5e7eb', maxWidth: 780, margin: '0 auto' },
  head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22 },
  cardTitle: { fontSize: 22, fontWeight: 800, color: '#1a1a2e', margin: '0 0 8px' },
  cardDesc: { fontSize: 14, color: '#6b7280', margin: 0, lineHeight: 1.5 },
  count: { flexShrink: 0, border: '1px solid #dbe4ff', background: '#f0f4ff', color: '#1e40af', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 800 },
  layout: { display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)', gap: 18 },
  rail: { display: 'flex', flexDirection: 'column', gap: 10 },
  railItem: { textAlign: 'left', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 4 },
  railTitle: { fontSize: 13, color: '#1a1a2e', fontWeight: 800, overflowWrap: 'anywhere' },
  railMeta: { fontSize: 12, color: '#6b7280', overflowWrap: 'anywhere' },
  addStore: { background: '#fff', border: '1px dashed #9ca3af', borderRadius: 10, padding: '12px 14px', color: '#374151', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' },
  panel: { display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 },
  group: { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#f9fafb' },
  groupTitle: { fontSize: 13, fontWeight: 800, color: '#1a1a2e' },
  input: { padding: '11px 13px', border: '1px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none', minWidth: 0 },
  providerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 },
  providerCard: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', textAlign: 'left', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px', cursor: 'pointer', fontFamily: 'inherit' },
  providerMark: { gridRow: 'span 2', alignSelf: 'start', background: '#eef2ff', color: ACCENT, borderRadius: 8, padding: '4px 6px', fontSize: 11, fontWeight: 800 },
  copy: { fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.5 },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 13, fontWeight: 700, color: '#374151' },
  hint: { fontSize: 12, color: '#6b7280', lineHeight: 1.4 },
  secretRow: { display: 'flex', gap: 8, alignItems: 'center' },
  secondaryButton: { background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 10, color: '#374151', fontSize: 13, fontWeight: 700, padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit' },
  actions: { display: 'flex', gap: 12 },
  primary: { padding: '13px 0', background: ACCENT, color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  secondary: { padding: '13px 18px', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  error: { padding: '10px 14px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, fontSize: 13, fontWeight: 500 },
  savedPane: { display: 'flex', flexDirection: 'column', gap: 14 },
  success: { background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 4, color: '#065f46', fontSize: 13 },
  activationBox: { background: '#f0f4ff', border: '1px solid #c7d2fe', borderRadius: 10, padding: 16, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 },
  steps: { fontSize: 13, color: '#374151', paddingLeft: 18, margin: 0, lineHeight: 1.7 },
  footerActions: { marginTop: 20, display: 'flex', justifyContent: 'center' },
};
