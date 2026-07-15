import { describe, expect, it } from 'vitest';
import { isCanvasWidget, itemsFromMessages, widgetTitle } from './canvas';
import type { WidgetBlock } from './ChatMessageRenderer';

function fence(block: Record<string, unknown>): string {
  return '```mib-widget\n' + JSON.stringify(block) + '\n```';
}

const chart = (title?: string) =>
  fence({
    type: 'chart',
    chartType: 'bar',
    ...(title ? { title } : {}),
    labels: ['Mon', 'Tue'],
    datasets: [{ label: 'Sales', data: [1, 2] }],
  });

const metric = fence({ type: 'metric', metrics: [{ label: 'Revenue', value: 1200 }] });

describe('itemsFromMessages', () => {
  it('extracts canvas widgets from agent messages only', () => {
    const items = itemsFromMessages([
      { role: 'user', content: chart('User chart never pins') },
      { role: 'agent', content: `Here you go\n${chart('Weekly sales')}` },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Weekly sales');
    expect(items[0].messageIndex).toBe(1);
    expect(items[0].widgetIndex).toBe(0);
  });

  it('gives identical widgets distinct occurrence ids sharing a hash', () => {
    const items = itemsFromMessages([
      { role: 'agent', content: chart('Same') },
      { role: 'agent', content: chart('Same') },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].id).not.toBe(items[1].id);
    expect(items[0].id.split(':')[0]).toBe(items[1].id.split(':')[0]);
  });

  it('handles multiple widgets in one message and mixed types', () => {
    const items = itemsFromMessages([{ role: 'agent', content: `${metric}\n${chart('After metric')}` }]);
    expect(items.map((i) => i.widget.type)).toEqual(['metric', 'chart']);
    expect(items[1].widgetIndex).toBe(1);
  });

  it('ignores malformed fences and empty transcripts', () => {
    expect(itemsFromMessages([])).toEqual([]);
    expect(itemsFromMessages([{ role: 'agent', content: '```mib-widget\nnot json\n```' }])).toEqual([]);
  });
});

describe('isCanvasWidget / widgetTitle', () => {
  it('accepts chart/table/metric only', () => {
    expect(isCanvasWidget({ type: 'chart' } as WidgetBlock)).toBe(true);
    expect(isCanvasWidget({ type: 'table' } as WidgetBlock)).toBe(true);
    expect(isCanvasWidget({ type: 'metric' } as WidgetBlock)).toBe(true);
    expect(isCanvasWidget({ type: 'todo' } as WidgetBlock)).toBe(false);
  });

  it('falls back to a type-derived title', () => {
    expect(widgetTitle({ type: 'chart', chartType: 'pie' } as WidgetBlock)).toBe('pie chart');
    expect(widgetTitle({ type: 'metric' } as WidgetBlock)).toBe('Metrics');
    expect(widgetTitle({ type: 'table', title: 'Top SKUs' } as WidgetBlock)).toBe('Top SKUs');
  });
});
