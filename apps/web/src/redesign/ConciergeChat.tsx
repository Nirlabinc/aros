import { useState, FormEvent } from 'react';
import { CONCIERGE_SEED, SUGGESTIONS, type ChatMsg } from './shellData';

/**
 * Concierge chat home — the day-one surface. Preview uses a canned assistant
 * reply; real wiring posts to the shre-router POST /v1/chat and streams back
 * (the existing ArosChat transport), rendering the same bubbles.
 */
export function ConciergeChat() {
  const [messages, setMessages] = useState<ChatMsg[]>(CONCIERGE_SEED);
  const [draft, setDraft] = useState('');

  function send(text: string) {
    const q = text.trim();
    if (!q) return;
    setMessages(prev => [
      ...prev,
      { from: 'me', text: q },
      {
        from: 'shre',
        text: 'Yesterday you did $18,240 across all 5 stores — up 4.2% week-over-week. Harbor led at $4,910; Elm St Express lagged at $2,180. Want me to break it down by category or flag anything unusual?',
        meta: 'Shre · Local',
      },
    ]);
    setDraft('');
  }

  return (
    <div className="aros-chat">
      <div className="aros-thread">
        {messages.map((m, i) => (
          <div key={i} className={`aros-msg ${m.from === 'me' ? 'aros-msg--me' : ''}`}>
            <div className="aros-msg__av">{m.from === 'me' ? 'DR' : 'S'}</div>
            <div>
              <div className="aros-msg__bubble">{m.text}</div>
              {m.meta && <div className="aros-msg__meta">{m.meta}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="aros-composer">
        <div className="aros-chips">
          <button className="aros-chip" type="button"><span className="aros-chip__dot" />Connect Store</button>
          <button className="aros-chip" type="button"><span className="aros-chip__dot" />Connect Apps</button>
        </div>
        <form className="aros-inputrow" onSubmit={(e: FormEvent) => { e.preventDefault(); send(draft); }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder='Message Shre… try “How were sales yesterday?”'
            aria-label="Message Shre"
          />
          <button className="aros-send" type="submit" aria-label="Send">↑</button>
        </form>
        <div className="aros-suggest">
          {SUGGESTIONS.map(s => (
            <button key={s} type="button" className="aros-suggest__btn" onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
