import { useState, useRef, useEffect, type FormEvent } from 'react';
import { chatReplyText } from '../../lib/chatReply';
import { useVoice, cancelSpeech, type VoiceApi } from '../../aros-ai/voice';
import { AiDisclosureModal, AiDisclosureNotice, useAiDisclosure } from '../../components/AiDisclosure';
import { useAuth } from '../../contexts/AuthContext';
import { AttachSheet } from '../../redesign/attach/AttachSheet';
import { AttachmentThumbs } from '../../redesign/attach/AttachmentThumbs';
import { type Attachment, toWire, barcodeLookupQuery } from '../../redesign/attach/attachments';

/**
 * StartChat — the day-one landing surface for a freshly signed-up tenant.
 *
 * Time-to-first-value journey: the user lands here (NOT in a config wizard),
 * the session is put in DEMO MODE (sample "Party Liquor Demo" store), and the
 * agent immediately shows proactive insights drawn from real sample numbers
 * plus suggested questions — so value lands before any integration is required.
 *
 * "Set up your workspace" is an in-context CTA (value first, config second),
 * not a gate. It enters the resumable journey at /onboarding (model → connect →
 * readiness) once the user is sold.
 */

// /api/v1/* remains proxied server-side for already-shipped bundles.
const ROUTER_URL = (import.meta as any).env?.VITE_ROUTER_URL || '';
const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');
const DEMO_SESSION_KEY = 'aros-demo-session';
const INTENT_KEY = 'aros-intent';

function getIntent(): string {
  try {
    return localStorage.getItem(INTENT_KEY) || 'sales-inventory';
  } catch {
    return 'sales-inventory';
  }
}

interface Message {
  role: 'user' | 'agent';
  content: string;
  attachments?: Attachment[];
}

interface Activation {
  store: string;
  insights: string[];
  suggestedQuestions: string[];
}

function getDemoSessionId(): string {
  try {
    let id = localStorage.getItem(DEMO_SESSION_KEY);
    if (!id) {
      id = `demo-${crypto.randomUUID()}`;
      localStorage.setItem(DEMO_SESSION_KEY, id);
    }
    return id;
  } catch {
    return `demo-${Math.abs(Date.now())}`;
  }
}

export function StartChat() {
  const aiDisclosure = useAiDisclosure();
  const { session, tenant } = useAuth();
  const sessionId = useRef<string>(getDemoSessionId());
  const intent = useRef<string>(getIntent());
  const [messages, setMessages] = useState<Message[]>([]);
  const [activation, setActivation] = useState<Activation | null>(null);
  const [checkingStore, setCheckingStore] = useState(true);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceConvo, setVoiceConvo] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const voiceConvoRef = useRef(voiceConvo);
  const voiceRef = useRef<VoiceApi | null>(null);
  useEffect(() => { voiceConvoRef.current = voiceConvo; }, [voiceConvo]);
  useEffect(() => () => cancelSpeech(), []);

  // Honesty gate, then demo bootstrap. A tenant that already has a connected
  // store must never land on the sample-store surface (journey contract:
  // sample data is for tenants with NO connector) — they resume the setup
  // journey instead, whose connect/readiness steps reflect their real state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/store/summary`, {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}),
          },
        });
        if (res.ok) {
          const d = await res.json();
          if (!cancelled && (d?.connected || d?.hasConnector)) {
            window.location.replace('/onboarding');
            return;
          }
        }
      } catch { /* check is best-effort — brand-new tenants proceed to demo */ }
      if (cancelled) return;
      setCheckingStore(false);
      try {
        await fetch(`${ROUTER_URL}/v1/demo/enable`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId.current, intent: intent.current }),
        });
      } catch { /* demo flag is best-effort; chat still works */ }
      try {
        const res = await fetch(`${ROUTER_URL}/v1/demo/activation?intent=${encodeURIComponent(intent.current)}`);
        if (res.ok && !cancelled) setActivation((await res.json()) as Activation);
      } catch { /* activation is best-effort */ }
    })();
    return () => { cancelled = true; };
    // ProtectedRoute guarantees session/tenant are resolved before mount.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  const sendMessage = async (text: string, atts: Attachment[] = pending): Promise<boolean> => {
    const t = text.trim();
    if ((!t && atts.length === 0) || sendingRef.current) return false;
    sendingRef.current = true;
    const hasAttachments = atts.length > 0;
    setMessages((prev) => [...prev, { role: 'user', content: t, ...(hasAttachments ? { attachments: atts } : {}) }]);
    setInput('');
    setPending([]);
    setAttachError('');
    setSending(true);
    let reply = 'Something went wrong reaching your agent. Please try again.';
    try {
      const res = await fetch(`${ROUTER_URL}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'aros-agent',
          sessionId: sessionId.current,
          // Sent every request so demo mode is restart-proof (no dependence on a
          // server-side session flag that an in-memory store could lose).
          demoMode: true,
          demoScenario: intent.current,
          messages: [{ role: 'user', content: t || 'Please review the attached file(s).' }],
          ...(hasAttachments ? { attachments: atts.map(toWire) } : {}),
          stream: false,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      reply = chatReplyText(data);
      setMessages((prev) => [...prev, { role: 'agent', content: reply }]);
      if (voiceConvoRef.current) voiceRef.current?.speak(reply);
      return true;
    } catch {
      // Honest failure: never fabricate a description of an unread attachment.
      const msg = hasAttachments
        ? 'I couldn’t read that attachment right now. I won’t guess what it contains — please try again in a moment.'
        : 'Something went wrong reaching your agent. Please try again.';
      setMessages((prev) => [...prev, { role: 'agent', content: msg }]);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
    return true;
  };

  const voice = useVoice({
    handsFree: voiceConvo,
    getInput: () => input,
    setInput,
    onSend: (text) => { if (sendingRef.current) return false; void sendMessage(text); return true; },
  });
  voiceRef.current = voice;

  const toggleVoiceConvo = () => {
    setVoiceConvo((on) => {
      const next = !on;
      if (!next) cancelSpeech();
      if (next && voice.supported && !voice.listening) voice.toggleMic();
      return next;
    });
  };

  const onBarcode = (upc: string) => { void sendMessage(barcodeLookupQuery(upc), []); };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void sendMessage(input); };
  const fresh = messages.length === 0;

  // Never flash the sample surface while deciding whether this tenant is
  // already connected (one authed round-trip).
  if (checkingStore) {
    return (
      <div style={{ ...s.wrapper, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>AROS</div>
      </div>
    );
  }

  return (
    <div style={s.wrapper}>
      {/* First-chat AI disclosure — renders nothing unless TERMS_GATE_ENABLED */}
      <AiDisclosureModal show={aiDisclosure.showModal} onAcknowledge={() => void aiDisclosure.acknowledge()} />
      {/* Top bar with in-context connect CTA */}
      <header style={s.topbar}>
        <div style={s.brand}>AROS</div>
        <div style={s.sampleBadge}>
          <span style={s.dot} /> Exploring with sample data{activation ? ` · ${activation.store}` : ''}
        </div>
        <a href="/onboarding" style={s.connectBtn}>Set up your workspace</a>
      </header>

      <main style={s.main}>
        <div style={s.column}>
          {fresh && (
            <div style={s.hero}>
              <h1 style={s.h1}>Here's what your agent already sees</h1>
              <p style={s.sub}>
                This is running on a sample store. Ask anything — then connect your own store for real numbers.
              </p>
              {activation && (
                <div style={s.insightList}>
                  {activation.insights.map((ins, i) => (
                    <div key={i} style={s.insightCard}>
                      <span style={s.insightIcon}>✦</span>
                      <span>{ins}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{ ...s.row, justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ ...s.bubble, ...(m.role === 'user' ? s.bubbleUser : s.bubbleAgent) }}>
                {m.attachments && m.attachments.length > 0 && <AttachmentThumbs attachments={m.attachments} size={52} />}
                {m.content && <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</span>}
              </div>
            </div>
          ))}
          {sending && <div style={{ ...s.row, justifyContent: 'flex-start' }}><div style={{ ...s.bubble, ...s.bubbleAgent, color: '#9ca3af' }}>Thinking…</div></div>}
          <div ref={endRef} />
        </div>
      </main>

      <footer style={s.footer}>
        <div style={s.column}>
          {fresh && activation && (
            <div style={s.chips}>
              {activation.suggestedQuestions.map((q) => (
                <button key={q} onClick={() => void sendMessage(q)} style={s.chip}>{q}</button>
              ))}
            </div>
          )}
          {pending.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <AttachmentThumbs attachments={pending} size={52} onRemove={(i) => setPending((prev) => prev.filter((_, idx) => idx !== i))} />
            </div>
          )}
          {attachError && <div role="status" style={{ marginBottom: 8, fontSize: 12.5, color: '#b45309' }}>{attachError}</div>}
          <form onSubmit={onSubmit} style={s.inputBar}>
            <AttachSheet
              existing={pending}
              onAttach={(a) => { setAttachError(''); setPending((prev) => [...prev, ...a]); }}
              onBarcode={onBarcode}
              onError={setAttachError}
              disabled={sending}
              accent={ACCENT}
            />
            {voice.supported && (
              <button
                type="button"
                onClick={toggleVoiceConvo}
                aria-pressed={voiceConvo}
                title={voiceConvo ? 'Voice conversation on — replies are read aloud' : 'Start a voice conversation'}
                style={{ ...s.voiceBtn, ...(voiceConvo ? { background: ACCENT, color: '#fff', borderColor: ACCENT } : null) }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  {voiceConvo ? <><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></> : <><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>}
                </svg>
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={voice.listening ? 'Listening…' : 'Ask about your store…'}
              autoFocus
              enterKeyHint="send"
              style={s.input}
            />
            {voice.supported && (
              <button
                type="button"
                onClick={voice.toggleMic}
                aria-pressed={voice.listening}
                aria-label={voice.listening ? 'Stop dictation' : 'Dictate a message'}
                title={voice.listening ? 'Stop dictation' : 'Dictate a message'}
                style={{ ...s.voiceBtn, color: voice.listening ? '#ef4444' : '#6b7280' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
              </button>
            )}
            <button type="submit" disabled={(!input.trim() && pending.length === 0) || sending} style={{ ...s.send, opacity: (!input.trim() && pending.length === 0) || sending ? 0.5 : 1 }}>
              Send
            </button>
          </form>
          <AiDisclosureNotice />
        </div>
      </footer>
    </div>
  );
}

const ACCENT = '#3b5bdb';
const s: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#f7f8fc', fontFamily: 'Inter, system-ui, sans-serif', color: '#1a1a2e' },
  topbar: { display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0 },
  brand: { fontWeight: 800, fontSize: 18, letterSpacing: -0.5 },
  sampleBadge: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280', background: '#f0f4ff', padding: '4px 10px', borderRadius: 20 },
  dot: { width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block' },
  connectBtn: { marginLeft: 'auto', background: ACCENT, color: '#fff', textDecoration: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700 },
  main: { flex: 1, overflowY: 'auto', padding: '24px 16px' },
  column: { width: '100%', maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 },
  hero: { marginBottom: 8 },
  h1: { fontSize: 24, fontWeight: 800, margin: '8px 0 6px' },
  sub: { fontSize: 14, color: '#6b7280', margin: '0 0 16px' },
  insightList: { display: 'flex', flexDirection: 'column', gap: 10 },
  insightCard: { display: 'flex', gap: 10, alignItems: 'flex-start', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px', fontSize: 14, lineHeight: 1.5, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  insightIcon: { color: ACCENT, fontWeight: 700, flexShrink: 0 },
  row: { display: 'flex' },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: '11px 15px', fontSize: 14, lineHeight: 1.5 },
  bubbleUser: { background: ACCENT, color: '#fff' },
  bubbleAgent: { background: '#fff', color: '#1a1a2e', border: '1px solid #e5e7eb' },
  footer: { flexShrink: 0, padding: '12px 16px 20px', background: 'linear-gradient(#f7f8fc00, #f7f8fc 30%)' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: { padding: '8px 14px', borderRadius: 20, fontSize: 13, background: '#fff', color: ACCENT, border: '1px solid #d6def9', cursor: 'pointer', fontFamily: 'inherit' },
  inputBar: { display: 'flex', gap: 8, background: '#fff', border: '1px solid #d1d5db', borderRadius: 12, padding: 6 },
  input: { flex: 1, border: 'none', outline: 'none', padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', background: 'transparent' },
  send: { background: ACCENT, color: '#fff', border: 'none', borderRadius: 8, padding: '0 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  voiceBtn: { width: 40, alignSelf: 'stretch', border: 'none', background: 'transparent', color: '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
};
