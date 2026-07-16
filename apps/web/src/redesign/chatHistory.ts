import type { ChatMsg, Conversation } from './shellData';

const PREFIX = 'aros.chat.history.v1';
const EVENT = 'aros-chat-history-changed';
const MAX_CONVERSATIONS = 30;
const key = (tenantId?: string) => `${PREFIX}:${tenantId || 'personal'}`;

export function loadChatHistory(tenantId?: string): Conversation[] {
  try { const value = JSON.parse(localStorage.getItem(key(tenantId)) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

export function saveChatConversation(tenantId: string | undefined, id: string, messages: ChatMsg[]) {
  const first = messages.find(message => message.from === 'me')?.text.trim();
  const last = [...messages].reverse().find(message => message.from !== 'me')?.text.trim();
  if (!first || !last) return;
  const conversation: Conversation = {
    id, title: first.length > 60 ? `${first.slice(0, 57)}…` : first,
    preview: last.replace(/```mib-widget[\s\S]*?```/g, '').trim().slice(0, 140) || 'Structured result',
    when: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), messages: messages.slice(-50),
  };
  try {
    const history = loadChatHistory(tenantId).filter(item => item.id !== id);
    localStorage.setItem(key(tenantId), JSON.stringify([conversation, ...history].slice(0, MAX_CONVERSATIONS)));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { tenantId } }));
  } catch { /* Chat remains usable when browser storage is unavailable. */ }
}

export function subscribeChatHistory(tenantId: string | undefined, listener: () => void) {
  const onChange = (event: Event) => { if ((event as CustomEvent<{ tenantId?: string }>).detail?.tenantId === tenantId) listener(); };
  const onStorage = (event: StorageEvent) => { if (event.key === key(tenantId)) listener(); };
  window.addEventListener(EVENT, onChange); window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener('storage', onStorage); };
}
