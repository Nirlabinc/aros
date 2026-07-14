import { useState, useRef, useEffect, type FormEvent } from 'react';

/**
 * StartChat — the day-one landing surface for a freshly signed-up tenant.
 *
 * Time-to-first-value journey: the user lands here (NOT in a config wizard),
 * the session is put in DEMO MODE (sample "Party Liquor Demo" store), and the
 * agent immediately shows proactive insights drawn from real sample numbers
 * plus suggested questions — so value lands before any integration is required.
 *
 * "Connect your store" is an in-context CTA (value first, credentials second),
 * not a gate. It leads to /connect — the actual store-connection step — and
 * from there to /onboarding (plan + business setup) once the user is sold.
 */

const ROUTER_URL = (import.meta as any).env?.VITE_ROUTER_URL || '/api';
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
  const sessionId = useRef<string>(getDemoSessionId());
  const intent = useRef<string>(getIntent());
  const [messages, setMessages] = useState<Message[]>([]);
  const [activation, setActivation] = useState<Activation | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Enable demo mode for this session + fetch the activation payload on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
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
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  const sendMessage = async (text: string) => {
    const t = text.trim();
    if (!t || sending) return;
    setMessages((prev) => [...prev, { role: 'user', content: t }]);
    setInput('');
    setSending(true);
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
          messages: [{ role: 'user', content: t }],
          stream: false,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = data.response || data.message || data.content || 'No response received.';
      setMessages((prev) => [...prev, { role: 'agent', content: reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'agent', content: 'Something went wrong reaching your agent. Please try again.' }]);
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void sendMessage(input); };
  const fresh = messages.length === 0;

  return (
    <div style={s.wrapper}>
      {/* Top bar with in-context connect CTA */}
      <header style={s.topbar}>
        <div style={s.brand}>AROS</div>
        <div style={s.sampleBadge}>
          <span style={s.dot} /> Exploring with sample data{activation ? ` · ${activation.store}` : ''}
        </div>
        <a href="/connect" style={s.connectBtn}>Connect your store</a>
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
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</span>
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
          <form onSubmit={onSubmit} style={s.inputBar}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your store…"
              autoFocus
              style={s.input}
            />
            <button type="submit" disabled={!input.trim() || sending} style={{ ...s.send, opacity: !input.trim() || sending ? 0.5 : 1 }}>
              Send
            </button>
          </form>
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
};
