import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useWhitelabel } from '../whitelabel/WhitelabelProvider';

// ---------------------------------------------------------------------------
// Theme palettes (shre-chat style)
// ---------------------------------------------------------------------------

const SC_DARK = {
  bg1: '#0d0d0f', bg2: '#161618', bg3: '#1e1e22',
  bgInput: 'rgba(255,255,255,0.06)', bgHover: 'rgba(255,255,255,0.06)',
  msgUser: 'rgba(99,141,255,0.10)', msgAi: 'rgba(255,255,255,0.045)',
  text1: '#ececf1', text2: '#a1a1aa', text3: '#6b6b76',
  border1: 'rgba(255,255,255,0.1)', border2: 'rgba(255,255,255,0.065)',
  accent: '#638dff', accentSoft: 'rgba(99,141,255,0.14)',
};

const SC_LIGHT = {
  bg1: '#f5f5f7', bg2: '#ffffff', bg3: '#eeeef0',
  bgInput: 'rgba(0,0,0,0.04)', bgHover: 'rgba(0,0,0,0.05)',
  msgUser: 'rgba(79,110,220,0.09)', msgAi: 'rgba(0,0,0,0.035)',
  text1: '#1a1a1e', text2: '#52525b', text3: '#71717a',
  border1: 'rgba(0,0,0,0.12)', border2: 'rgba(0,0,0,0.08)',
  accent: '#4f6edc', accentSoft: 'rgba(79,110,220,0.10)',
};

// ---------------------------------------------------------------------------
// Lightweight markdown
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<em>$1</em>')
    .replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<em>$1</em>')
    .replace(/`([^`\n]+?)`/g, '<code style="background:rgba(128,128,128,0.15);padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>')
    .replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, (_m, t, u) => {
      const s = u.trim().toLowerCase();
      if (s.startsWith('javascript:') || s.startsWith('data:') || s.startsWith('vbscript:')) return t;
      return `<a href="${u}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">${t}</a>`;
    })
    .replace(/^### (.+)$/gm, '<strong style="font-size:1.05em">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="font-size:1.1em">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong style="font-size:1.15em">$1</strong>')
    .replace(/^[\-\*] (.+)$/gm, '\u2022 $1');
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'aros-chat-messages';
const MAX_STORED = 50;

interface Message { role: 'user' | 'agent'; content: string; timestamp: number; }

function loadMessages(greeting: string): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Message[];
  } catch {}
  return [{ role: 'agent', content: greeting, timestamp: Date.now() }];
}

function persistMessages(msgs: Message[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-MAX_STORED))); } catch {}
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const QUICK_ACTIONS = ['Show today\'s sales', 'Check low inventory', 'Reorder recommendations'];

// /api/v1/* remains proxied server-side for already-shipped bundles.
const ROUTER_URL = import.meta.env.VITE_ROUTER_URL || '';

export function ArosChat() {
  const { config } = useWhitelabel();
  // Detect theme from whitelabel config background color
  const bgColor = config.theme?.colors?.background || '#ffffff';
  const isLight = bgColor.toLowerCase() === '#ffffff' || bgColor.toLowerCase() === '#fff' || bgColor.startsWith('rgb(255');
  const c = isLight ? SC_LIGHT : SC_DARK;

  const greeting = config.agent.greeting ?? 'What do you need?';
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(greeting));
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userNearBottom, setUserNearBottom] = useState(true);

  useEffect(() => { persistMessages(messages); }, [messages]);

  useEffect(() => {
    if (userNearBottom) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, userNearBottom]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setUserNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 200);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || sending) return;
    const userMsg: Message = { role: 'user', content: text.trim(), timestamp: Date.now() };
    setSending(true);
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    try {
      const res = await fetch(`${ROUTER_URL}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'aros-agent',
          messages: [{ role: 'user', content: text.trim() }],
          stream: false,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = data.response || data.message || data.content || 'No response received.';
      setMessages((prev) => [...prev, { role: 'agent', content: reply, timestamp: Date.now() }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'agent', content: 'Something went wrong. Please try again.', timestamp: Date.now() }]);
    } finally {
      setSending(false);
    }
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    await sendMessage(input);
  };

  const clearChat = () => { setMessages([{ role: 'agent', content: greeting, timestamp: Date.now() }]); localStorage.removeItem(STORAGE_KEY); };

  if (!config.features?.agentChat) return null;

  const agentName = config.agent.name;
  const font = '-apple-system, "SF Pro Text", "SF Pro Display", BlinkMacSystemFont, "Helvetica Neue", "Inter", system-ui, sans-serif';

  return (
    <>
      {/* FAB trigger */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={`Chat with ${agentName}`}
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
            width: 48, height: 48, borderRadius: '50%',
            background: c.accent, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', cursor: 'pointer',
            boxShadow: `0 4px 16px ${c.accentSoft}`,
            transition: 'transform 200ms', fontFamily: font,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
      )}

      {/* Overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
        />
      )}

      {/* Slide-in panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(380px, 100vw)', zIndex: 9999,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          display: 'flex', flexDirection: 'column',
          background: c.bg1,
          borderLeft: `1px solid ${c.border2}`,
          fontFamily: font,
          WebkitFontSmoothing: 'antialiased',
          color: c.text1, fontSize: 14, letterSpacing: '-0.022em',
        } as React.CSSProperties}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
          background: c.bg2, borderBottom: `1px solid ${c.border2}`, flexShrink: 0,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: c.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: c.text1 }}>{agentName}</div>
            <div style={{ fontSize: 10, color: c.text3 }}>Online</div>
          </div>
          {messages.length > 1 && (
            <button
              onClick={clearChat}
              title="Clear chat"
              style={{
                width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', cursor: 'pointer', color: c.text3, transition: 'background 150ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = c.bgHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            aria-label="Close chat"
            style={{
              width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer', color: c.text2, transition: 'background 150ms, color 150ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = c.bgHover; e.currentTarget.style.color = c.text1; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = c.text2; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          {/* Quick actions (show when only greeting is present) */}
          {messages.length <= 1 && !sending && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action}
                  onClick={() => sendMessage(action)}
                  style={{
                    padding: '6px 12px', borderRadius: 16, fontSize: 12,
                    background: c.accentSoft, color: c.accent, border: `1px solid ${c.border2}`,
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'background 150ms',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = c.bgHover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = c.accentSoft; }}
                >
                  {action}
                </button>
              ))}
            </div>
          )}
          {messages.map((msg, i) => {
            const isUser = msg.role === 'user';
            return (
              <div key={i} style={{ display: 'flex', gap: 8, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                {!isUser && (
                  <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, marginTop: 2, background: c.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>
                    </svg>
                  </div>
                )}
                <div style={{
                  maxWidth: '80%', borderRadius: 16, padding: '10px 16px', fontSize: 13, lineHeight: 1.47,
                  background: isUser ? c.msgUser : c.msgAi, color: c.text1,
                  border: `1px solid ${isUser ? c.accentSoft : c.border2}`,
                }}>
                  {isUser ? (
                    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</span>
                  ) : (
                    <span style={{ wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                  )}
                </div>
                {isUser && (
                  <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, marginTop: 2, background: c.bgInput, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={c.text2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
          {/* Loading indicator */}
          {sending && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, marginTop: 2, background: c.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>
                </svg>
              </div>
              <div style={{
                maxWidth: '80%', borderRadius: 16, padding: '10px 16px', fontSize: 13, lineHeight: 1.47,
                background: c.msgAi, color: c.text3, border: `1px solid ${c.border2}`,
              }}>
                Thinking...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={send}
          style={{
            padding: '12px 16px', flexShrink: 0,
            background: c.bg2, borderTop: `1px solid ${c.border2}`,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, borderRadius: 10, border: `1px solid ${c.border1}`, background: c.bgInput }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message ${agentName}...`}
              style={{ flex: 1, minWidth: 0, padding: '10px 14px', fontSize: 13, background: 'transparent', border: 'none', outline: 'none', color: c.text1, lineHeight: 1.47 }}
            />
          </div>
          <button
            type="submit"
            disabled={!input.trim() || sending}
            style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: (!input.trim() || sending) ? c.bgInput : c.accent,
              color: (!input.trim() || sending) ? c.text3 : '#fff',
              border: 'none', cursor: (!input.trim() || sending) ? 'not-allowed' : 'pointer',
              transition: 'background 150ms',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </form>
      </div>
    </>
  );
}
