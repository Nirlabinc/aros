// Conversation canvas — the right pane in chat mode. Renders the outputs Shre
// produces (KPI tiles, charts, tables). Preview uses example data derived from
// the "How were sales yesterday?" answer; wired build receives these as
// mib-widget content blocks on the chat message (same contract as Sia/StorePulse).

const SALES_BY_STORE = [
  { store: 'Harbor', value: 4910 },
  { store: 'Main St', value: 4120 },
  { store: 'Oak Ave', value: 3480 },
  { store: '3rd St Express', value: 3550 },
  { store: 'Elm St Express', value: 2180 },
];
const LOW_STOCK = [
  { sku: 'Marlboro Gold 100s', store: 'Harbor', onHand: 4, par: 24 },
  { sku: 'Monster Energy 16oz', store: 'Main St', onHand: 9, par: 36 },
  { sku: 'Coca-Cola 20oz', store: 'Oak Ave', onHand: 12, par: 48 },
  { sku: 'Red Bull 12oz', store: '3rd St Express', onHand: 6, par: 30 },
];

import { useCanvasDemo } from './data';
import { WidgetRenderer } from '../aros-ai/ChatMessageRenderer';
import { type CanvasWidgetItem } from '../aros-ai/canvas';
import { warmPalette } from './ConciergeChat';

/** Canvas — demo example in preview; live renders the mib-widget items derived
 *  from the conversation transcript (shared platform contract). */
export function Canvas({ items }: { items?: CanvasWidgetItem[] }) {
  const demo = useCanvasDemo();
  const max = Math.max(...SALES_BY_STORE.map(s => s.value));
  if (!demo) {
    if (items && items.length) {
      const palette = warmPalette();
      return (
        <div className="rsx2-canvas">
          <div className="rsx2-canvas__head">
            <div><div className="rsx2-canvas__eyebrow">Conversation canvas</div><h2 className="rsx2-canvas__title">From your chat</h2></div>
          </div>
          {items.map(it => (
            <div key={it.id} className="rsx2-vizcard">
              <div className="rsx2-vizcard__title">{it.title}</div>
              <WidgetRenderer block={it.widget} palette={palette} />
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="rsx2-canvas">
        <div className="rsx2-empty rsx2-empty--tall">
          <div className="rsx2-empty__icon">📊</div>
          <div className="rsx2-empty__title">Nothing on the canvas yet</div>
          <div className="rsx2-empty__text">Ask Shre a question — charts, tables, and numbers from the answer show up here.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="rsx2-canvas">
      <div className="rsx2-canvas__head">
        <div>
          <div className="rsx2-canvas__eyebrow">Conversation canvas</div>
          <h2 className="rsx2-canvas__title">Yesterday · all stores</h2>
        </div>
        <span className="rsx2-canvas__src">from “How were sales yesterday?”</span>
      </div>

      <div className="rsx2-kpis">
        <Kpi value="$18,240" label="Net sales" delta="+4.2%" up />
        <Kpi value="1,204" label="Transactions" delta="+1.8%" up />
        <Kpi value="$15.15" label="Avg basket" delta="−0.4%" />
      </div>

      <div className="rsx2-vizcard">
        <div className="rsx2-vizcard__title">Sales by store</div>
        <div className="rsx2-bars">
          {SALES_BY_STORE.map(s => (
            <div key={s.store} className="rsx2-bar">
              <span className="rsx2-bar__label">{s.store}</span>
              <div className="rsx2-bar__track"><div className="rsx2-bar__fill" style={{ width: `${(s.value / max) * 100}%` }} /></div>
              <span className="rsx2-bar__val">${s.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rsx2-vizcard">
        <div className="rsx2-vizcard__title">Low stock — needs reorder</div>
        <table className="rsx2-table">
          <thead><tr><th>SKU</th><th>Store</th><th>On hand</th><th>Par</th></tr></thead>
          <tbody>
            {LOW_STOCK.map(r => (
              <tr key={r.sku + r.store}>
                <td>{r.sku}</td><td>{r.store}</td>
                <td><span className="rsx2-tag rsx2-tag--warn">{r.onHand}</span></td>
                <td>{r.par}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ value, label, delta, up }: { value: string; label: string; delta: string; up?: boolean }) {
  return (
    <div className="rsx2-kpi">
      <div className="rsx2-kpi__value">{value}</div>
      <div className="rsx2-kpi__label">{label}</div>
      <div className={`rsx2-kpi__delta ${up ? 'is-up' : ''}`}>{delta}</div>
    </div>
  );
}
