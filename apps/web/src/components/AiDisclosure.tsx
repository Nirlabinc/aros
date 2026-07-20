/**
 * First-chat AI disclosure (§2 of the consent spec) — flag-gated.
 *
 * - AiDisclosureModal: shown once per user before their first AI chat
 *   message; re-shown when the terms version bumps. "Got it" records the
 *   acknowledgement server-side ({user_id, tenant_id, disclosure_key,
 *   version, acknowledged_at}).
 * - AiDisclosureNotice: the permanent low-key reminder under the chat input —
 *   "AI-generated — verify before acting." (This persistent line is what
 *   actually protects in practice; a one-time popup alone is weak evidence.)
 *
 * Both render nothing while TERMS_GATE_ENABLED is off (default).
 */

import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ackAiDisclosure, useTermsStatus } from '../lib/terms';

function localAckKey(version: string, userId: string): string {
  return `aros-ai-disclosure-ack:${version}:${userId}`;
}

/** Shared state for both chat surfaces. */
export function useAiDisclosure() {
  const { session, tenant, user } = useAuth();
  const accessToken = session?.access_token || null;
  const status = useTermsStatus({ accessToken, tenantId: tenant?.id });
  const [dismissed, setDismissed] = useState(false);

  let locallyAcked = false;
  if (status && user) {
    try { locallyAcked = localStorage.getItem(localAckKey(status.termsVersion, user.id)) === '1'; } catch { /* ignore */ }
  }

  const gateEnabled = !!status?.gateEnabled;
  const showModal =
    gateEnabled &&
    !!accessToken &&
    status?.aiDisclosureAcknowledged === false &&
    !locallyAcked &&
    !dismissed;

  const acknowledge = async () => {
    setDismissed(true); // optimistic — never trap the user on a network hiccup
    if (status && user) {
      try { localStorage.setItem(localAckKey(status.termsVersion, user.id), '1'); } catch { /* ignore */ }
    }
    if (status && accessToken) {
      await ackAiDisclosure({ accessToken, tenantId: tenant?.id }, status.aiChatDisclosureKey);
    }
  };

  return { gateEnabled, showModal, acknowledge };
}

export function AiDisclosureModal({ show, onAcknowledge }: { show: boolean; onAcknowledge: () => void }) {
  if (!show) return null;
  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-labelledby="ai-disclosure-title">
      <div style={s.card}>
        <h2 id="ai-disclosure-title" style={s.title}>Before you chat with your AI assistant</h2>
        <p style={s.body}>
          This assistant uses AI. <strong>AI can make mistakes</strong> — answers may be inaccurate
          or incomplete, so double-check important information against your own records before
          acting on it. It isn’t financial, legal, or tax advice.
        </p>
        <p style={s.body}>
          To improve the product, your chats and activity may be used to make the AI better, as
          described in our{' '}
          <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" style={s.link}>Privacy Policy</a>
          {' '}and{' '}
          <a href="/legal/terms" target="_blank" rel="noopener noreferrer" style={s.link}>Terms</a>.
          Admins can manage training preferences in Settings → Privacy.
        </p>
        <div style={s.actions}>
          <button type="button" style={s.gotIt} onClick={onAcknowledge}>Got it</button>
          <a href="/legal/terms" target="_blank" rel="noopener noreferrer" style={s.viewTerms}>View Terms</a>
        </div>
      </div>
    </div>
  );
}

/** Permanent reminder under every chat input (only while the flag is on). */
export function AiDisclosureNotice() {
  const { session, tenant } = useAuth();
  const status = useTermsStatus({ accessToken: session?.access_token || null, tenantId: tenant?.id });
  if (!status?.gateEnabled) return null;
  return <div style={s.notice}>AI-generated — verify before acting.</div>;
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9_000,
    background: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(3px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  card: {
    width: '100%', maxWidth: 460, background: '#fff', borderRadius: 16,
    padding: '28px 28px 22px', boxShadow: '0 20px 56px rgba(15, 23, 42, 0.3)', color: '#1a1a2e',
  },
  title: { margin: '0 0 14px', fontSize: 19, fontWeight: 800, lineHeight: 1.35 },
  body: { margin: '0 0 12px', fontSize: 14, lineHeight: 1.65, color: '#374151' },
  link: { color: '#3b5bdb', fontWeight: 600, textDecoration: 'underline' },
  actions: { display: 'flex', alignItems: 'center', gap: 16, marginTop: 18 },
  gotIt: {
    border: 0, borderRadius: 10, padding: '10px 26px', background: '#3b5bdb', color: '#fff',
    fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },
  viewTerms: { fontSize: 13, color: '#3b5bdb', fontWeight: 600, textDecoration: 'underline' },
  notice: { marginTop: 6, textAlign: 'center', fontSize: 11.5, color: '#9ca3af' },
};
