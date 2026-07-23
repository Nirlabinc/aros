import { useState, useRef, useEffect, FormEvent } from 'react';
import { useVoice, cancelSpeech, type VoiceApi } from '../aros-ai/voice';

// Chat API — local dev only; production uses offline knowledge base
const CHAT_API = (window as any).__CHAT_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5497' : '');

interface Message {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

const QUICK_ACTIONS = [
  { label: 'What is AROS?', prompt: 'What is AROS and how does it help retail stores?' },
  { label: 'Pricing', prompt: 'What are the AROS pricing plans?' },
  { label: 'POS Systems', prompt: 'Which POS systems does AROS integrate with?' },
  { label: 'Talk to Sales', prompt: null },
];

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceConvo, setVoiceConvo] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const voiceConvoRef = useRef(voiceConvo);
  const openRef = useRef(open);
  const voiceRef = useRef<VoiceApi | null>(null);
  useEffect(() => { voiceConvoRef.current = voiceConvo; }, [voiceConvo]);
  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  async function sendMessage(text: string): Promise<boolean> {
    if (!text.trim() || loadingRef.current) return false;
    loadingRef.current = true;
    const userMsg: Message = { role: 'user', content: text, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    let reply: string;
    try {
      if (!CHAT_API) throw new Error('offline');

      const res = await fetch(`${CHAT_API}/v1/chat/public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          context: 'aros-website-visitor',
          history: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        reply = data.reply || data.message || data.content || 'I can help with that! Please visit our contact page for detailed assistance.';
      } else {
        reply = getOfflineResponse(text);
      }
    } catch {
      reply = getOfflineResponse(text);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
    setMessages(prev => [...prev, { role: 'assistant', content: reply, ts: Date.now() }]);
    if (voiceConvoRef.current && openRef.current) voiceRef.current?.speak(reply);
    return true;
  }

  const voice = useVoice({
    handsFree: voiceConvo,
    getInput: () => input,
    setInput,
    onSend: (text) => { if (loadingRef.current) return false; void sendMessage(text); return true; },
  });
  voiceRef.current = voice;

  const toggleVoiceConvo = () => {
    setVoiceConvo(on => {
      const next = !on;
      if (!next) cancelSpeech();
      if (next && voice.supported && !voice.listening) voice.toggleMic();
      return next;
    });
  };
  useEffect(() => { if (!open) { voice.stop(); cancelSpeech(); } }, [open, voice]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    void sendMessage(text);
  }

  function handleQuickAction(action: typeof QUICK_ACTIONS[0]) {
    if (action.prompt) {
      sendMessage(action.prompt);
    } else {
      window.location.href = '/contact';
    }
  }

  return (
    <>
      {/* Floating Button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={s.fab}
          aria-label="Open chat"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Chat Panel */}
      {open && (
        <div style={s.panel}>
          {/* Header */}
          <div style={s.header}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>AROS Assistant</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>AI-powered help</div>
            </div>
            <button onClick={() => setOpen(false)} style={s.closeBtn} aria-label="Close chat">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={s.messages}>
            {messages.length === 0 && (
              <div style={s.welcome}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Hi there!</div>
                <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5, marginBottom: 16 }}>
                  I'm the AROS assistant. Ask me about features, pricing, integrations, or anything else.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {QUICK_ACTIONS.map(a => (
                    <button
                      key={a.label}
                      onClick={() => handleQuickAction(a)}
                      style={s.quickBtn}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                <div style={m.role === 'user' ? s.userBubble : s.botBubble}>
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
                <div style={{ ...s.botBubble, color: '#9ca3af' }}>Thinking...</div>
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} style={s.inputBar}>
            {voice.supported && (
              <button
                type="button"
                onClick={toggleVoiceConvo}
                aria-pressed={voiceConvo}
                title={voiceConvo ? 'Voice conversation on — replies are read aloud' : 'Start a voice conversation'}
                style={{ ...s.voiceBtn, ...(voiceConvo ? s.voiceBtnOn : null) }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  {voiceConvo ? <><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></> : <><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>}
                </svg>
              </button>
            )}
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={voice.listening ? 'Listening…' : 'Ask anything...'}
              style={s.input}
              disabled={loading}
              enterKeyHint="send"
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
            <button
              type="submit"
              disabled={loading || !input.trim()}
              style={!input.trim() || loading ? { ...s.sendBtn, opacity: 0.4 } : s.sendBtn}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </form>

          {/* Footer */}
          <div style={s.footerBar}>
            <a href="/contact" style={s.footerLink}>Contact Sales</a>
            <span style={{ color: '#d1d5db' }}>|</span>
            <a href="https://support.nirtek.net" target="_blank" rel="noopener" style={s.footerLink}>Support Center</a>
          </div>
        </div>
      )}
    </>
  );
}

/** Offline knowledge base responses when API unavailable */
function getOfflineResponse(query: string): string {
  const q = query.toLowerCase();

  if (q.includes('pric') || q.includes('cost') || q.includes('plan')) {
    return 'AROS offers 4 plans:\n\n- **Free** ($0) — 1 store, self-hosted, local AI\n- **Starter** ($49/mo) — Cloud AI, 5 agents, daily backups\n- **Pro** ($149/mo) — Up to 10 stores, 14 agents, API access\n- **Business** ($499/mo) — Fleet analytics, SSO, white-label\n\nVisit our [pricing page](/signup) to get started!';
  }

  if (q.includes('pos') || q.includes('integrat') || q.includes('rapidrms') || q.includes('verifone')) {
    return 'AROS currently integrates with:\n\n- **RapidRMS** — Full POS integration with real-time sync\n- **Verifone Commander** — Transaction data + inventory management\n\nMore integrations coming soon! Check our [POS hub](https://nirtek.net/pos/) for details.';
  }

  if (q.includes('what is') || q.includes('aros') || q.includes('about')) {
    return 'AROS (Agentic Retail Operating System) is an AI-powered platform for retail stores. It connects to your POS system and deploys AI agents that handle analytics, inventory, customer support, and operations — 24/7.\n\nStart free with 1 store, or upgrade for cloud AI and multi-store management.';
  }

  if (q.includes('agent') || q.includes('ai')) {
    return 'AROS provides up to 14 specialized AI agents that handle:\n\n- Sales analytics & reporting\n- Inventory management\n- Customer support\n- Operations & scheduling\n- Marketing insights\n\nAgents learn from your data and improve over time.';
  }

  if (q.includes('demo') || q.includes('sales') || q.includes('contact')) {
    return 'I\'d love to connect you with our sales team! Please visit our [contact page](/contact) to schedule a personalized demo.';
  }

  if (q.includes('support') || q.includes('help') || q.includes('issue')) {
    return 'For technical support, visit our [Support Center](https://support.nirtek.net). For account-specific help, you can also reach us through the [contact form](/contact).';
  }

  if (q.includes('self-host') || q.includes('docker') || q.includes('deploy')) {
    return 'AROS can be self-hosted using Docker — your data stays on your hardware with full privacy and zero vendor lock-in. The Free plan includes self-hosted deployment for 1 store.';
  }

  return 'Thanks for your question! For the most detailed answer, I\'d recommend:\n\n- Check our [features](/#features) page\n- Visit the [Support Center](https://support.nirtek.net)\n- Or [contact our team](/contact) directly\n\nIs there something specific I can help with?';
}

const s: Record<string, React.CSSProperties> = {
  fab: {
    position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
    width: 56, height: 56, borderRadius: 28,
    background: '#3b5bdb', color: '#fff', border: 'none',
    boxShadow: '0 4px 16px rgba(59,91,219,0.4)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'transform 0.2s',
  },
  panel: {
    position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
    width: 380, height: 520, borderRadius: 16,
    background: '#fff', boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
    border: '1px solid #e5e7eb',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    background: '#3b5bdb', padding: '14px 16px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#fff', cursor: 'pointer',
    padding: 4, display: 'flex', alignItems: 'center',
  },
  messages: {
    flex: 1, padding: 16, overflowY: 'auto',
    display: 'flex', flexDirection: 'column',
  },
  welcome: {
    background: '#f8f9fb', borderRadius: 12, padding: 16, marginBottom: 8,
  },
  quickBtn: {
    fontSize: 12, fontWeight: 500, color: '#3b5bdb', background: '#eef2ff',
    border: '1px solid #c7d2fe', borderRadius: 100, padding: '6px 12px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  userBubble: {
    background: '#3b5bdb', color: '#fff', borderRadius: '14px 14px 4px 14px',
    padding: '10px 14px', fontSize: 13, lineHeight: 1.5, maxWidth: '80%',
  },
  botBubble: {
    background: '#f3f4f6', color: '#1a1a2e', borderRadius: '14px 14px 14px 4px',
    padding: '10px 14px', fontSize: 13, lineHeight: 1.5, maxWidth: '85%',
    whiteSpace: 'pre-wrap',
  },
  inputBar: {
    display: 'flex', gap: 8, padding: '10px 12px',
    borderTop: '1px solid #f0f0f0',
  },
  input: {
    flex: 1, padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 10,
    fontSize: 14, fontFamily: 'inherit', outline: 'none',
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 10, border: 'none',
    background: '#3b5bdb', color: '#fff', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  voiceBtn: {
    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
    border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  voiceBtnOn: {
    background: '#3b5bdb', color: '#fff', border: '1px solid #3b5bdb',
  },
  footerBar: {
    display: 'flex', justifyContent: 'center', gap: 8, padding: '8px 12px',
    borderTop: '1px solid #f0f0f0', background: '#fafbfc',
  },
  footerLink: {
    fontSize: 11, color: '#6b7280', textDecoration: 'none', fontWeight: 500,
  },
};
