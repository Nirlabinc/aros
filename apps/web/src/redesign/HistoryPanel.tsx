import { type Conversation } from './shellData';
import { useConversations } from './data';

// History tab (right pane in chat mode) — recall a past conversation into the
// chat. Demo threads in preview; the tenant's real threads (empty until wired)
// in a live build.
export function HistoryPanel({ onRecall, activeId }: { onRecall: (c: Conversation) => void; activeId?: string }) {
  const { list } = useConversations();
  return (
    <div className="rsx2-history">
      <div className="rsx2-history__head">
        <div className="rsx2-canvas__eyebrow">Recent conversations</div>
        <h2 className="rsx2-canvas__title">History</h2>
      </div>
      {list.length === 0 ? (
        <div className="rsx2-empty">
          <div className="rsx2-empty__icon">💬</div>
          <div className="rsx2-empty__title">No conversations yet</div>
          <div className="rsx2-empty__text">Your chats with Shre will show up here to revisit.</div>
        </div>
      ) : (
        <div className="rsx2-history__list">
          {list.map(c => (
          <button key={c.id} className={`rsx2-histrow ${activeId === c.id ? 'is-on' : ''}`} onClick={() => onRecall(c)}>
            <div className="rsx2-histrow__top">
              <span className="rsx2-histrow__title">{c.title}</span>
              <span className="rsx2-histrow__when">{c.when}</span>
            </div>
            <div className="rsx2-histrow__preview">{c.preview}</div>
            <span className="rsx2-histrow__recall">Recall →</span>
          </button>
          ))}
        </div>
      )}
    </div>
  );
}
