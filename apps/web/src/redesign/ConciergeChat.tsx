import { useState, useRef, useEffect, FormEvent } from 'react';
import { CONCIERGE_SEED, SUGGESTIONS, type ChatMsg } from './shellData';
import { useConnectionSummary, useDemo } from './data';
import { useAuth } from '../contexts/AuthContext';
import { branding } from './branding';
import { ChatMessageRenderer, type ChatPalette } from '../aros-ai/ChatMessageRenderer';
import { itemsFromMessages, type CanvasWidgetItem } from '../aros-ai/canvas';
import { AiDisclosureModal, AiDisclosureNotice, useAiDisclosure } from '../components/AiDisclosure';

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
const API_BASE = (window as any).__AROS_API_URL__ || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');
const FLEET_GUIDANCE = `AROS specialist fleet: Ana handles inventory and reorders; Sammy handles revenue, margin, and P&L; Victor handles fraud and loss prevention; Larry handles labor and scheduling; Rita handles reviews and reputation; Store Operations handles connected-store sales and health. External web, news, and weather require a Research & External Intelligence agent with web.search and weather.read capabilities.`;
const EXTERNAL_INTELLIGENCE_REQUEST = /\b(weather|forecast|temperature|news|headlines|search (?:the )?web|browse (?:the )?(?:web|internet)|look up online)\b/i;

type ActiveAgent = { name: string; capabilities: string[] };

/** Humanize a router agentId for the message meta line ("aros-agent" → "Store Operations"). */
function agentLabel(id: string): string {
  const KNOWN: Record<string, string> = { 'aros-agent': 'Store Operations', storepulse: 'StorePulse Analyst', 'chain-operator': 'Chain Operator', 'cpg-analyst': 'CPG Analyst' };
  return KNOWN[id] || id.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function customerFacingReply(reply: string): string {
  const cleaned = reply.includes('</think>') ? reply.split('</think>').pop()!.trim() : reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (/\btool\s+[\w.-]+\s+failed\b|\bfailed on all paths\b|\bweb_fetch\b|\baccess control\b/i.test(cleaned)) {
    return 'I could not retrieve the connected store data for that request. The Store Operations Agent is active, but its data capability is temporarily unavailable. Check Connection Health for the affected connection, or try again in a moment.';
  }
  return cleaned;
}

/**
 * Concierge chat home. Sends to the real shre-router /v1/chat and renders the
 * reply; falls back to a friendly error bubble on failure (e.g. no router in
 * the preview). Optimistic user bubble + typing indicator.
 */
export function ConciergeChat({ onConnect, onConnectApps, seed, focusOnMount, initial, onCanvasItems }: { onConnect?: () => void; onConnectApps?: () => void; seed?: string; focusOnMount?: boolean; initial?: ChatMsg[]; onCanvasItems?: (items: CanvasWidgetItem[]) => void }) {
  const demo = useDemo();
  const connections = useConnectionSummary();
  const { session, tenant } = useAuth();
  const aiDisclosure = useAiDisclosure();
  const mark = branding().concierge.charAt(0).toUpperCase();
  const palette = warmPalette();
  const [messages, setMessages] = useState<ChatMsg[]>(initial && initial.length ? initial : demo ? CONCIERGE_SEED : []);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [activeAgents, setActiveAgents] = useState<ActiveAgent[]>([]);
  const [activeModel, setActiveModel] = useState('auto');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);
  // Derive canvas items from the transcript via the shared mib-widget contract.
  useEffect(() => {
    onCanvasItems?.(itemsFromMessages(messages.map(m => ({ role: m.from === 'me' ? 'user' : 'agent', content: m.text }))));
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (seed) { setDraft(seed); inputRef.current?.focus({ preventScroll: true }); } }, [seed]);
  useEffect(() => { if (focusOnMount) inputRef.current?.focus({ preventScroll: true }); }, [focusOnMount]);
  useEffect(() => {
    if (demo || !session?.access_token) return;
    fetch(`${API_BASE}/api/resources/agent`, { headers: { Authorization: `Bearer ${session.access_token}`, ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}) } })
      .then(response => response.ok ? response.json() : null)
      .then(data => setActiveAgents((Array.isArray(data?.resources) ? data.resources : [])
        .filter((item: any) => item?.status === 'active' && item?.name)
        .map((item: any) => ({ name: String(item.name), capabilities: Array.isArray(item.capabilities) ? item.capabilities.map(String) : [] }))))
      .catch(() => setActiveAgents([]));
  }, [demo, session?.access_token, tenant?.id]);
  useEffect(() => {
    if (demo || !session?.access_token) return;
    fetch(`${API_BASE}/api/settings/models`, { headers: { Authorization: `Bearer ${session.access_token}`, ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}) } })
      .then(response => response.ok ? response.json() : null)
      .then(data => { const selected = (data?.providers || []).find((item: any) => item?.isActive); if (selected?.model) setActiveModel(String(selected.model)); })
      .catch(() => setActiveModel('auto'));
  }, [demo, session?.access_token, tenant?.id]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    const nextMessages: ChatMsg[] = [...messages, { from: 'me', text: q }];
    setMessages(prev => [...prev, { from: 'me', text: q }]);
    setDraft('');
    const hasExternalIntelligence = activeAgents.some(agent => agent.capabilities.some(capability => capability === 'weather.read' || capability === 'web.search'));
    if (EXTERNAL_INTELLIGENCE_REQUEST.test(q) && !hasExternalIntelligence) {
      const active = activeAgents.length ? activeAgents.map(agent => agent.name).join(', ') : 'no specialists reported';
      setMessages(prev => [...prev, {
        from: 'shre',
        text: `That request needs the Research & External Intelligence agent (weather.read / web.search), and it is not active in this workspace. Active agents: ${active}. An owner or admin can open Agents to activate a published specialist, or Marketplace to add the required agent or fleet. If it is not listed in Marketplace, it has not been published for activation yet.`,
        meta: 'AROS fleet routing',
      }]);
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`${ROUTER_URL}/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'x-channel': 'aros',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          ...(tenant?.id ? { 'x-tenant-id': tenant.id, 'x-aros-tenant-id': tenant.id, 'X-Workspace-ID': tenant.id } : {}),
        },
        body: JSON.stringify({
          agentId: 'aros-agent',
          messages: [
            { role: 'system', content: `You are the AROS fleet orchestrator. ${FLEET_GUIDANCE} Active agents for this workspace: ${activeAgents.length ? activeAgents.map(agent => agent.name).join(', ') : 'none reported'}. Never expose internal reasoning, tool names, tool errors, or access-control implementation details. If a request needs a capability that is not active, state which agent or capability is unavailable, briefly list the relevant active specialists and what they can do, then direct an owner/admin to Agents to activate an available specialist or Marketplace to add the required agent/fleet. If the required agent is not published, say so clearly. Do not claim an agent is installed when it is not.` },
            ...nextMessages.map(message => ({ role: message.from === 'me' ? 'user' : 'assistant', content: message.text })),
          ],
          stream: false,
          model: activeModel,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rawReply = [data?.response, data?.message?.content, data?.message, data?.content].find(value => typeof value === 'string' && value.trim());
      if (!rawReply) throw new Error('The model returned an unsupported response.');
      const reply = customerFacingReply(rawReply);
      if (!reply) throw new Error('The model returned no customer-facing answer.');
      // Attribution: the router returns _shre.{decisionTrace.agentId, toolsUsed, model} — surface it.
      const shre = data?._shre || data?.metadata || {};
      const agent = shre?.decisionTrace?.agentId || data?.agent || shre?.agent;
      const tools: string[] = Array.isArray(shre?.toolsUsed) ? shre.toolsUsed.map(String) : [];
      const label = agent && agent !== 'main' ? agentLabel(agent) : 'Shre';
      const model = data?.model || shre?.model;
      setMessages(prev => [...prev, { from: 'shre', text: reply, meta: model ? `${label} · ${model}` : 'Shre · Local', agent, tools }]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown chat error';
      setMessages(prev => [...prev, { from: 'shre', text: `I couldn’t complete that request (${detail}). Try again in a moment.`, meta: 'Shre · Local' }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="aros-chat">
      {/* First-chat AI disclosure — renders nothing unless TERMS_GATE_ENABLED */}
      <AiDisclosureModal show={aiDisclosure.showModal} onAcknowledge={() => void aiDisclosure.acknowledge()} />
      <div className="aros-thread">
        {messages.length === 0 && !sending && <div className="rsx2-empty rsx2-empty--tall"><div className="rsx2-empty__title">Start a conversation</div><div className="rsx2-empty__text">{connections.total > 0 ? 'Ask about sales, inventory, operations, or any connected tool.' : 'Ask a general question, or connect a store to use live retail data.'}</div></div>}
        {messages.map((m, i) => (
          <div key={i} className={`aros-msg ${m.from === 'me' ? 'aros-msg--me' : ''}`}>
            <div className="aros-msg__av">{m.from === 'me' ? 'DR' : mark}</div>
            <div>
              <div className="aros-msg__bubble">
                {m.from === 'me' ? m.text : <ChatMessageRenderer content={m.text} palette={palette} />}
              </div>
              {m.meta && (
                <div className="aros-msg__meta">
                  {m.meta}
                  {m.tools && m.tools.length > 0 && <span className="aros-msg__tools" title={`Tools used: ${m.tools.join(', ')}`}> · {m.tools.join(' · ')}</span>}
                </div>
              )}
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
        <div className="aros-chips">
          {connections.total === 0 && <button className="aros-chip" type="button" onClick={onConnect}><span className="aros-chip__dot" />Connect Store</button>}
          <button className="aros-chip" type="button" onClick={onConnectApps}><span className="aros-chip__dot" />Connect Apps</button>
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
        <AiDisclosureNotice />
        {!messages.some(m => m.from === 'me') && (
          <div className="aros-suggest">
            {SUGGESTIONS.map(sg => (
              <button key={sg} type="button" className="aros-suggest__btn" onClick={() => send(sg)} disabled={sending}>{sg}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
