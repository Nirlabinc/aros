import { CONVERSATIONS, type Conversation } from './shellData';

// History tab (right pane in chat mode) — recall a past conversation into the
// chat. Preview data is canned; wired build lists the tenant's real threads.
export function HistoryPanel({ onRecall, activeId }: { onRecall: (c: Conversation) => void; activeId?: string }) {
  return (
    <div className="rsx2-history">
      <div className="rsx2-history__head">
        <div className="rsx2-canvas__eyebrow">Recent conversations</div>
        <h2 className="rsx2-canvas__title">History</h2>
      </div>
      <div className="rsx2-history__list">
        {CONVERSATIONS.map(c => (
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
    </div>
  );
}
