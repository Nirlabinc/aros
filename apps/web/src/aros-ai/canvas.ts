/**
 * Data canvas derivation — turns the mib-widget blocks the concierge emits in
 * chat into pinnable canvas items (chat = control plane, canvas = persistent
 * data plane). Purely derived from the transcript via the shared mib-widget
 * fence — no new backend contract.
 */
import { CANVAS_WIDGET_TYPES, extractWidgets, type WidgetBlock } from './ChatMessageRenderer';

export interface CanvasWidgetItem {
  /** Content-derived id (block hash + occurrence counter): stable across
   *  re-renders and the 50-message transcript trim — positional ids drift. */
  id: string;
  widget: WidgetBlock;
  title: string;
  /** Position within the CURRENT in-memory transcript (for click lookups). */
  messageIndex: number;
  /** Index among ALL widgets of that message — matches the inline renderer. */
  widgetIndex: number;
}

export function isCanvasWidget(widget: WidgetBlock): boolean {
  return (CANVAS_WIDGET_TYPES as readonly string[]).includes(widget.type);
}

export function widgetTitle(widget: WidgetBlock): string {
  const title = widget.title;
  if (typeof title === 'string' && title.trim()) return title;
  if (widget.type === 'chart') return `${String(widget.chartType ?? 'bar')} chart`;
  if (widget.type === 'metric') return 'Metrics';
  return 'Table';
}

/** djb2 — tiny stable hash for content-derived ids. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function itemsFromMessages(
  messages: Array<{ role: string; content: string }>,
): CanvasWidgetItem[] {
  const items: CanvasWidgetItem[] = [];
  const seen = new Map<string, number>();
  messages.forEach((message, messageIndex) => {
    if (message.role !== 'agent' || !message.content) return;
    const { widgets } = extractWidgets(message.content);
    widgets.forEach((widget, widgetIndex) => {
      if (!isCanvasWidget(widget)) return;
      const contentHash = hash(JSON.stringify(widget));
      const occurrence = seen.get(contentHash) ?? 0;
      seen.set(contentHash, occurrence + 1);
      items.push({
        id: `w${contentHash}:${occurrence}`,
        widget,
        title: widgetTitle(widget),
        messageIndex,
        widgetIndex,
      });
    });
  });
  return items;
}
