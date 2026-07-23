import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import { useWhitelabel } from '../whitelabel/WhitelabelProvider';
import { useChatTheme } from './chatTheme';
import { ChatMessageRenderer } from './ChatMessageRenderer';
import { useCanvas } from './CanvasContext';
import { itemsFromMessages } from './canvas';
import { chatReplyText } from '../lib/chatReply';
import { useVoice, cancelSpeech, type VoiceApi } from './voice';

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
  const c = useChatTheme();
  const canvas = useCanvas();

  const greeting = config.agent.greeting ?? 'What do you need?';
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(greeting));
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  // Voice-conversation mode: hands-free (each spoken utterance auto-sends) + replies read aloud.
  const [voiceConvo, setVoiceConvo] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userNearBottom, setUserNearBottom] = useState(true);

  useEffect(() => { persistMessages(messages); }, [messages]);

  // Publish the concierge's mib-widget results to the data canvas. A NEW
  // widget auto-opens the docked canvas on desktop; mobile only pins it (its
  // overlay would cover the chat). The count ref starts null so restoring a
  // persisted transcript never auto-opens — only fresh answers do.
  const { setItems: setCanvasItems, setOpen: setCanvasOpen, setSelectedId: setCanvasSelectedId } = canvas;
  const canvasCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (sending) return;
    const items = itemsFromMessages(messages);
    setCanvasItems(items);
    const prev = canvasCountRef.current;
    canvasCountRef.current = items.length;
    if (items.length === 0 || prev === null || items.length <= prev) return;
    setCanvasSelectedId(items[items.length - 1].id);
    if (window.matchMedia('(min-width: 768px)').matches) setCanvasOpen(true);
  }, [messages, sending, setCanvasItems, setCanvasOpen, setCanvasSelectedId]);

  const openWidgetOnCanvas = useCallback(
    (messageIndex: number, widgetIndex: number) => {
      const item = itemsFromMessages(messages).find(
        (entry) => entry.messageIndex === messageIndex && entry.widgetIndex === widgetIndex,
      );
      if (!item) return;
      setCanvasSelectedId(item.id);
      setCanvasOpen(true);
    },
    [messages, setCanvasOpen, setCanvasSelectedId],
  );

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

  // Synchronous guards/mirrors so hands-free callbacks see live state (React state lags a render).
  const sendingRef = useRef(false);
  const voiceConvoRef = useRef(voiceConvo);
  const openRef = useRef(open);
  const voiceRef = useRef<VoiceApi | null>(null);
  useEffect(() => { voiceConvoRef.current = voiceConvo; }, [voiceConvo]);
  useEffect(() => { openRef.current = open; }, [open]);

  const sendMessage = async (text: string): Promise<boolean> => {
    if (!text.trim() || sendingRef.current) return false;
    sendingRef.current = true;
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
      const reply = chatReplyText(data);
      setMessages((prev) => [...prev, { role: 'agent', content: reply, timestamp: Date.now() }]);
      // speak only if voice-conversation is still on and the panel is still open (checked live)
      if (voiceConvoRef.current && openRef.current) voiceRef.current?.speak(reply);
    } catch {
      setMessages((prev) => [...prev, { role: 'agent', content: 'Something went wrong. Please try again.', timestamp: Date.now() }]);
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
    // return false when busy so the hook keeps the utterance instead of dropping it
    onSend: (text) => { if (sendingRef.current) return false; void sendMessage(text); return true; },
  });
  voiceRef.current = voice;

  // Leaving conversation mode (or closing the panel) silences any in-flight speech.
  const toggleVoiceConvo = () => {
    setVoiceConvo((on) => {
      const next = !on;
      if (!next) cancelSpeech();
      if (next && voice.supported && !voice.listening) voice.toggleMic();
      return next;
    });
  };
  useEffect(() => { if (!open) { voice.stop(); cancelSpeech(); } }, [open, voice]);

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
          {canvas.items.length > 0 && (
            <button
              onClick={() => { canvas.setOpen(!canvas.open); canvas.setFocus(false); }}
              title={canvas.open ? 'Hide the data canvas' : `Data canvas (${canvas.items.length})`}
              aria-pressed={canvas.open}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, height: 28, padding: '0 8px', borderRadius: 6,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: canvas.open ? c.accent : c.text3, fontSize: 11, fontFamily: 'inherit', transition: 'background 150ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = c.bgHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              {canvas.items.length}
            </button>
          )}
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
                    <ChatMessageRenderer
                      content={msg.content}
                      palette={c}
                      onOpenWidget={(widgetIndex) => openWidgetOnCanvas(i, widgetIndex)}
                    />
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
          {voice.supported && (
            <button
              type="button"
              onClick={toggleVoiceConvo}
              aria-pressed={voiceConvo}
              title={voiceConvo ? 'Voice conversation on — spoken messages send and replies are read aloud' : 'Start a voice conversation (hands-free + spoken replies)'}
              style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: voiceConvo ? c.accent : c.bgInput, color: voiceConvo ? '#fff' : c.text3,
                border: `1px solid ${c.border1}`, cursor: 'pointer', transition: 'background 150ms, color 150ms',
              }}
            >
              {voiceConvo ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
              )}
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, borderRadius: 10, border: `1px solid ${c.border1}`, background: c.bgInput }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={voice.listening ? 'Listening…' : `Message ${agentName}...`}
              enterKeyHint="send"
              style={{ flex: 1, minWidth: 0, padding: '10px 14px', fontSize: 13, background: 'transparent', border: 'none', outline: 'none', color: c.text1, lineHeight: 1.47 }}
            />
            {voice.supported && (
              <button
                type="button"
                onClick={voice.toggleMic}
                aria-pressed={voice.listening}
                aria-label={voice.listening ? 'Stop dictation' : 'Dictate a message'}
                title={voice.listening ? 'Stop dictation' : 'Dictate a message'}
                style={{
                  width: 34, height: 34, marginRight: 3, borderRadius: 8, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: voice.listening ? '#ff5f57' : c.text3, transition: 'color 150ms',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              </button>
            )}
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
