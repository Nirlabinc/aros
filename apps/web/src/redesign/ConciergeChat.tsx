import { useState, useRef, useEffect, FormEvent } from 'react';
import { CONCIERGE_SEED, SUGGESTIONS, type ChatMsg } from './shellData';
import { useConnectionSummary, useDemo } from './data';
import { useAuth } from '../contexts/AuthContext';
import { branding } from './branding';
import { ChatMessageRenderer, type ChatPalette } from '../aros-ai/ChatMessageRenderer';
import { itemsFromMessages, type CanvasWidgetItem } from '../aros-ai/canvas';
import { saveChatConversation } from './chatHistory';

/** Warm ChatPalette pulled from the live design tokens so the shared mib-widget
 *  renderer matches the current (light/dark) theme. */
export function warmPalette(): ChatPalette {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => s.getPropertyValue(n).trim() || fb;
  return { text1: v('--ink', '#23201b'), text2: v('--ink-2', '#6e6558'), text3: v('--ink-3', '#9b9385'), accent: v('--accent', '#b8842a'), border2: v('--line', '#e8e3d8') };
}

// Same transport contract as the existing ArosChat: the router is reached at
// ${ROUTER_URL}/v1/chat (proxied server-side when unset), body { agentId,
// messages, stream }, reply in data.response|message|content.
const ROUTER_URL = (import.meta as any).env?.VITE_ROUTER_URL || '';

/**
 * Concierge chat home. Sends to the real shre-router /v1/chat and renders the
 * reply; falls back to a friendly error bubble on failure (e.g. no router in
 * the preview). Optimistic user bubble + typing indicator.
 */
export function ConciergeChat({ onConnect, onConnectApps, seed, focusOnMount, initial, onCanvasItems }: { onConnect?: () => void; onConnectApps?: () => void; seed?: string; focusOnMount?: boolean; initial?: ChatMsg[]; onCanvasItems?: (items: CanvasWidgetItem[]) => void }) {
  const demo = useDemo();
  const { session, tenant } = useAuth();
  const connections = useConnectionSummary();
  const mark = branding().concierge.charAt(0).toUpperCase();
  const palette = warmPalette();
  const [messages, setMessages] = useState<ChatMsg[]>(initial && initial.length ? initial : demo ? CONCIERGE_SEED : []);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  const [selectedModel, setSelectedModel] = useState('auto');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const conversationId = useRef(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `chat-${Date.now()}`);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);
  // Derive canvas items from the transcript via the shared mib-widget contract.
  useEffect(() => {
    onCanvasItems?.(itemsFromMessages(messages.map(m => ({ role: m.from === 'me' ? 'user' : 'agent', content: m.text }))));
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (seed) { setDraft(seed); inputRef.current?.focus({ preventScroll: true }); } }, [seed]);
  useEffect(() => { if (focusOnMount) inputRef.current?.focus({ preventScroll: true }); }, [focusOnMount]);
  useEffect(() => {
    if (!session?.access_token) return;
    fetch('/api/gateway/model-routing', { headers: { Authorization: `Bearer ${session.access_token}`, ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}) } })
      .then(response => response.ok ? response.json() : Promise.reject()).then(data => setModels(Array.isArray(data.availableModels) ? data.availableModels : [])).catch(() => setModels([]));
  }, [session?.access_token, tenant?.id]);
  useEffect(() => { if (!demo) saveChatConversation(tenant?.id, conversationId.current, messages); }, [demo, messages, tenant?.id]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    setMessages(prev => [...prev, { from: 'me', text: q }]);
    setDraft('');
    setSending(true);
    try {
      const res = await fetch(`${ROUTER_URL}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}), ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}) },
        body: JSON.stringify({ agentId: 'aros-agent', model: selectedModel, tenantId: tenant?.id, workspaceId: tenant?.id, messages: [...messages.map(m => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text })), { role: 'user', content: q }], stream: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = data.response || data.message || data.content || 'No response received.';
      setMessages(prev => [...prev, { from: 'shre', text: reply, meta: 'Shre · Local' }]);
    } catch {
      setMessages(prev => [...prev, { from: 'shre', text: 'I couldn’t reach the store brain just now. Try again in a moment — your stores and data are unaffected.', meta: 'Shre · Local' }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="aros-chat">
      <div className="aros-thread">
        {messages.length === 0 && !sending && <div className="rsx2-empty rsx2-empty--tall"><div className="rsx2-empty__title">Start a conversation</div><div className="rsx2-empty__text">{connections.total > 0 ? 'Ask about sales, inventory, operations, or any connected tool.' : 'Ask a general question, or connect a store to use live retail data.'}</div></div>}
        {messages.map((m, i) => (
          <div key={i} className={`aros-msg ${m.from === 'me' ? 'aros-msg--me' : ''}`}>
            <div className="aros-msg__av">{m.from === 'me' ? 'DR' : mark}</div>
            <div>
              <div className="aros-msg__bubble">
                {m.from === 'me' ? m.text : <ChatMessageRenderer content={m.text} palette={palette} />}
              </div>
              {m.meta && <div className="aros-msg__meta">{m.meta}</div>}
            </div>
          </div>
        ))}
        {sending && (
          <div className="aros-msg">
            <div className="aros-msg__av">{mark}</div>
            <div className="aros-msg__bubble aros-msg__typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="aros-composer">
        <label className="aros-model-picker"><span>Model</span><select value={selectedModel} onChange={event => setSelectedModel(event.target.value)}><option value="auto">Auto · best available</option>{models.map(model => <option key={model.id} value={model.id}>{model.name} · {model.provider}</option>)}</select></label>
        <div className="aros-chips">
          {connections.total === 0 && <button className="aros-chip" type="button" onClick={onConnect}><span className="aros-chip__dot" />Connect Store</button>}
          <button className="aros-chip" type="button" onClick={onConnectApps}><span className="aros-chip__dot" />Marketplace</button>
        </div>
        <form className="aros-inputrow" onSubmit={(e: FormEvent) => { e.preventDefault(); send(draft); }}>
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={`Message ${branding().concierge}… try “How were sales yesterday?”`}
            aria-label={`Message ${branding().concierge}`}
            disabled={sending}
          />
          <button className="aros-send" type="submit" aria-label="Send" disabled={sending || !draft.trim()}>↑</button>
        </form>
        <div className="aros-suggest">
          {SUGGESTIONS.map(sg => (
            <button key={sg} type="button" className="aros-suggest__btn" onClick={() => send(sg)} disabled={sending}>{sg}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
