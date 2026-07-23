import type { ChatMsg, Conversation } from './shellData';

const PREFIX = 'aros.chat.history.v1';
const EVENT = 'aros-chat-history-changed';
const MAX_CONVERSATIONS = 30;
const key = (tenantId?: string) => `${PREFIX}:${tenantId || 'personal'}`;

export function loadChatHistory(tenantId?: string): Conversation[] {
  try { const value = JSON.parse(localStorage.getItem(key(tenantId)) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

/**
 * Drop the base64 payload before anything touches localStorage. A single 6 MB
 * photo is ~8 MB of data URL — comfortably over the ~5 MB per-origin quota — so
 * persisting it whole doesn't just bloat storage, it throws QuotaExceededError
 * and silently loses the WHOLE conversation history. Same treatment ArosChat
 * already applies to its transcript; durable attachments are Shared S's job.
 */
function stripAttachmentPayloads(messages: ChatMsg[]): ChatMsg[] {
  return messages.map(message => (
    message.attachments?.length
      ? { ...message, attachments: message.attachments.map(a => ({ ...a, dataUrl: '' })) }
      : message
  ));
}

export function saveChatConversation(tenantId: string | undefined, id: string, messages: ChatMsg[]) {
  const firstMine = messages.find(message => message.from === 'me');
  // An attachment-only turn has no text — title it by what was attached rather
  // than dropping the whole conversation from history.
  const first = firstMine?.text.trim() || (firstMine?.attachments?.length ? firstMine.attachments[0].name : '');
  const last = [...messages].reverse().find(message => message.from !== 'me')?.text.trim();
  if (!first || !last) return;
  const conversation: Conversation = {
    id, title: first.length > 60 ? `${first.slice(0, 57)}…` : first,
    preview: last.replace(/```mib-widget[\s\S]*?```/g, '').trim().slice(0, 140) || 'Structured result',
    when: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), messages: stripAttachmentPayloads(messages.slice(-50)),
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
