/**
 * ChatMessageRenderer — rich content renderer for the AROS concierge.
 *
 * Replaces the old regex-string renderMarkdown() + dangerouslySetInnerHTML with
 * real markdown (react-markdown + remark-gfm, which never emits raw HTML) plus
 * mib-widget blocks — the same ```mib-widget JSON fence contract used across
 * StorePulse and MIB, so charts/tables/metrics render identically everywhere.
 *
 * Theming: AROS chat uses JS palette objects (SC_DARK/SC_LIGHT) rather than the
 * dashboard's CSS vars, so colors come in via the `palette` prop.
 */
import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ── Palette (subset of ArosChat's SC_* objects the renderer needs) ──────────

export interface ChatPalette {
  text1: string;
  text2: string;
  text3: string;
  accent: string;
  border2: string;
}

// ── Widget model (shared mib-widget contract) ───────────────────────────────

export interface WidgetBlock {
  type: string;
  [key: string]: unknown;
}

const PALETTE = [
  '#60a5fa',
  '#4ade80',
  '#f59e0b',
  '#f87171',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#e879f9',
];

/** Widget types the data canvas can render — the canvas subset. */
export const CANVAS_WIDGET_TYPES = ['chart', 'table', 'metric'] as const;

const WIDGET_FENCE = /```mib-widget\s*\n([\s\S]*?)```/g;

export function extractWidgets(text: string): { cleanText: string; widgets: WidgetBlock[] } {
  const widgets: WidgetBlock[] = [];
  const cleanText = text.replace(WIDGET_FENCE, (_match, json) => {
    try {
      const parsed = JSON.parse(String(json).trim());
      if (parsed && typeof parsed.type === 'string') widgets.push(parsed);
    } catch {
      /* skip malformed */
    }
    return '';
  });
  return { cleanText: cleanText.trim(), widgets };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtVal(v: number, currency?: boolean): string {
  if (currency) {
    if (Math.abs(v) >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(v) >= 1_000) return '$' + (v / 1_000).toFixed(1) + 'K';
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return v % 1 === 0 ? v.toString() : v.toFixed(1);
}

// ── SVG charts (zero-dependency) ─────────────────────────────────────────────

function BarChart({ block, p }: { block: WidgetBlock; p: ChatPalette }) {
  const labels = (block.labels as string[]) ?? [];
  const datasets = (block.datasets as Array<{ data: number[]; label?: string }>) ?? [];
  const values = (datasets[0]?.data ?? []).map((v) => (typeof v === 'number' && isFinite(v) ? v : 0));
  const max = Math.max(...values, 1);
  const currency = block.currency === true;
  const barW = Math.min(40, Math.floor(360 / Math.max(labels.length, 1)));
  const h = 140;
  const chartW = labels.length * (barW + 12) + 24;

  return (
    <div style={{ margin: '8px 0' }}>
      {block.title ? <div style={{ fontSize: 12, fontWeight: 600, color: p.text1, marginBottom: 4 }}>{String(block.title)}</div> : null}
      <svg width="100%" height={h + 24} viewBox={`0 0 ${chartW} ${h + 24}`} style={{ display: 'block' }}>
        {[0.25, 0.5, 0.75, 1].map((frac) => (
          <line key={frac} x1={0} x2={chartW} y1={h - frac * h} y2={h - frac * h} stroke={p.border2} />
        ))}
        {values.map((v, i) => {
          const barH = Math.max((v / max) * h, 1);
          const x = 12 + i * (barW + 12);
          return (
            <g key={i}>
              <rect x={x} y={h - barH} width={barW} height={barH} rx={3} fill={PALETTE[i % PALETTE.length]} opacity={0.85}>
                <title>{labels[i]}: {fmtVal(v, currency)}</title>
              </rect>
              <text x={x + barW / 2} y={h - barH - 4} fill={p.text2} fontSize={9} textAnchor="middle">{fmtVal(v, currency)}</text>
              <text x={x + barW / 2} y={h + 14} fill={p.text3} fontSize={9} textAnchor="middle">{(labels[i] ?? '').slice(0, 10)}</text>
            </g>
          );
        })}
      </svg>
      {datasets.length > 1 && (
        <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
          {datasets.map((ds, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: p.text2 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: PALETTE[i % PALETTE.length] }} />
              {ds.label ?? `Series ${i + 1}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LineChart({ block, p }: { block: WidgetBlock; p: ChatPalette }) {
  const labels = (block.labels as string[]) ?? [];
  const datasets = (block.datasets as Array<{ data: number[]; label?: string }>) ?? [];
  const values = (datasets[0]?.data ?? []).map((v) => (typeof v === 'number' && isFinite(v) ? v : 0));
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 360;
  const h = 140;
  const currency = block.currency === true;
  const isArea = block.type === 'area' || block.chartType === 'area';

  const points = values.map((v, i) => ({
    x: 12 + (i / Math.max(values.length - 1, 1)) * (w - 24),
    y: h - 4 - ((v - min) / range) * (h - 12),
  }));
  const pathD = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
  const areaD = pathD + ` L ${points[points.length - 1].x} ${h} L ${points[0].x} ${h} Z`;

  return (
    <div style={{ margin: '8px 0' }}>
      {block.title ? <div style={{ fontSize: 12, fontWeight: 600, color: p.text1, marginBottom: 4 }}>{String(block.title)}</div> : null}
      <svg width="100%" height={h + 20} viewBox={`0 0 ${w} ${h + 20}`} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="arosAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PALETTE[0]} stopOpacity={0.3} />
            <stop offset="100%" stopColor={PALETTE[0]} stopOpacity={0} />
          </linearGradient>
        </defs>
        {isArea && <path d={areaD} fill="url(#arosAreaGrad)" />}
        <path d={pathD} fill="none" stroke={PALETTE[0]} strokeWidth={2} />
        {points.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r={3} fill={PALETTE[0]}>
            <title>{labels[i]}: {fmtVal(values[i], currency)}</title>
          </circle>
        ))}
        {labels
          .filter((_, i) => i % Math.ceil(labels.length / 6 || 1) === 0 || i === labels.length - 1)
          .map((l) => {
            const idx = labels.indexOf(l);
            const x = 12 + (idx / Math.max(values.length - 1, 1)) * (w - 24);
            return <text key={idx} x={x} y={h + 14} fill={p.text3} fontSize={9} textAnchor="middle">{l.slice(0, 10)}</text>;
          })}
      </svg>
    </div>
  );
}

function PieChart({ block, p }: { block: WidgetBlock; p: ChatPalette }) {
  const labels = (block.labels as string[]) ?? [];
  const datasets = (block.datasets as Array<{ data: number[] }>) ?? [];
  const values = (datasets[0]?.data ?? []).map((v) => (typeof v === 'number' && isFinite(v) ? Math.abs(v) : 0));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = 70;
  const cy = 70;
  const r = 58;
  let angle = 0;
  const currency = block.currency === true;

  const slices = values.map((v, i) => {
    const sweep = (v / total) * 360;
    const start = angle;
    angle += sweep;
    return { start, sweep, value: v, label: labels[i] ?? '', color: PALETTE[i % PALETTE.length] };
  });

  return (
    <div style={{ margin: '8px 0' }}>
      {block.title ? <div style={{ fontSize: 12, fontWeight: 600, color: p.text1, marginBottom: 4 }}>{String(block.title)}</div> : null}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <svg width={140} height={140} viewBox="0 0 140 140">
          {slices.map((s, i) => {
            const endAngle = s.start + Math.min(s.sweep, 359.99);
            const largeArc = s.sweep > 180 ? 1 : 0;
            const startRad = ((s.start - 90) * Math.PI) / 180;
            const endRad = ((endAngle - 90) * Math.PI) / 180;
            const x1 = cx + r * Math.cos(startRad);
            const y1 = cy + r * Math.sin(startRad);
            const x2 = cx + r * Math.cos(endRad);
            const y2 = cy + r * Math.sin(endRad);
            const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
            return (
              <path key={i} d={d} fill={s.color} opacity={0.85}>
                <title>{s.label}: {fmtVal(s.value, currency)} ({((s.value / total) * 100).toFixed(1)}%)</title>
              </path>
            );
          })}
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
          {slices.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, color: p.text2 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: s.color }} />
              <span>{s.label}</span>
              <span style={{ color: p.text3, marginLeft: 'auto' }}>{((s.value / total) * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TableWidget({ block, p }: { block: WidgetBlock; p: ChatPalette }) {
  const headers = (block.headers as string[]) ?? [];
  const rows = (block.rows as unknown[][]) ?? [];
  const currency = block.currency === true;

  return (
    <div style={{ margin: '8px 0', overflowX: 'auto' }}>
      {block.title ? <div style={{ fontSize: 12, fontWeight: 600, color: p.text1, marginBottom: 4 }}>{String(block.title)}</div> : null}
      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((hd, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${p.border2}`, color: p.text2, fontWeight: 600 }}>{hd}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {(row as unknown[]).map((cell, ci) => (
                <td key={ci} style={{ padding: '5px 8px', borderBottom: `1px solid ${p.border2}`, color: p.text1, textAlign: typeof cell === 'number' ? 'right' : 'left', fontVariantNumeric: 'tabular-nums' }}>
                  {typeof cell === 'number' ? fmtVal(cell, currency) : String(cell ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricWidget({ block, p }: { block: WidgetBlock; p: ChatPalette }) {
  const metrics = (block.metrics as Array<{ label: string; value: string | number; delta?: number; unit?: string }>) ?? [];
  if (metrics.length === 0 && block.label) {
    metrics.push({ label: block.label as string, value: block.value as string | number, delta: block.delta as number });
  }

  return (
    <div style={{ margin: '8px 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {metrics.map((m, i) => (
        <div key={i} style={{ background: p.border2, border: `1px solid ${p.border2}`, borderRadius: 10, padding: '8px 12px', minWidth: 100 }}>
          <div style={{ fontSize: 10, color: p.text3, marginBottom: 2 }}>{m.label}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: p.text1 }}>
            {typeof m.value === 'number' ? m.value.toLocaleString() : m.value}
            {m.unit && <span style={{ fontSize: 10, color: p.text3, marginLeft: 2 }}>{m.unit}</span>}
          </div>
          {m.delta != null && (
            <div style={{ fontSize: 10, fontWeight: 500, color: m.delta >= 0 ? '#4ade80' : '#f87171' }}>
              {m.delta >= 0 ? '+' : ''}{m.delta}%
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function WidgetRenderer({ block, palette }: { block: WidgetBlock; palette: ChatPalette }) {
  switch (block.type) {
    case 'chart': {
      const chartType = (block.chartType as string) ?? 'bar';
      if (chartType === 'line' || chartType === 'area') return <LineChart block={{ ...block, type: chartType }} p={palette} />;
      if (chartType === 'pie') return <PieChart block={block} p={palette} />;
      return <BarChart block={block} p={palette} />;
    }
    case 'table':
      return <TableWidget block={block} p={palette} />;
    case 'metric':
      return <MetricWidget block={block} p={palette} />;
    default:
      return null;
  }
}

// ── Main renderer ─────────────────────────────────────────────────────────────

const CANVAS_TYPES = new Set<string>(CANVAS_WIDGET_TYPES);

export function ChatMessageRenderer({
  content,
  palette,
  onOpenWidget,
}: {
  content: string;
  palette: ChatPalette;
  /** When provided, canvas-able widgets get an "Open on canvas" affordance. */
  onOpenWidget?: (widgetIndex: number) => void;
}) {
  const { cleanText, widgets } = useMemo(() => extractWidgets(content), [content]);

  return (
    <div style={{ wordBreak: 'break-word' }}>
      {cleanText && (
        <div className="aros-chat-md" style={{ fontSize: 13, lineHeight: 1.5 }}>
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: palette.accent, textDecoration: 'underline' }}>{children}</a>
              ),
              // Drop `node` (react-markdown's AST prop) so it isn't forwarded
              // to the DOM element.
              code: ({ className, children, node: _node, ...rest }) => {
                const isBlock = /language-/.test(className ?? '');
                if (!isBlock) {
                  return <code style={{ background: palette.border2, padding: '1px 4px', borderRadius: 3, fontSize: '0.9em' }} {...rest}>{children}</code>;
                }
                return (
                  <pre style={{ background: palette.border2, borderRadius: 8, padding: 10, overflowX: 'auto', fontSize: 12 }}>
                    <code {...rest}>{children}</code>
                  </pre>
                );
              },
              table: ({ children }) => (
                <div style={{ overflowX: 'auto', margin: '6px 0' }}>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>{children}</table>
                </div>
              ),
              th: ({ children }) => <th style={{ textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${palette.border2}`, color: palette.text2, fontWeight: 600 }}>{children}</th>,
              td: ({ children }) => <td style={{ padding: '4px 8px', borderBottom: `1px solid ${palette.border2}` }}>{children}</td>,
            }}
          >
            {cleanText}
          </Markdown>
        </div>
      )}

      {widgets.map((w, i) => (
        <div key={i}>
          <WidgetRenderer block={w} palette={palette} />
          {onOpenWidget && CANVAS_TYPES.has(w.type) && (
            <button
              type="button"
              onClick={() => onOpenWidget(i)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2, fontSize: 11, color: palette.text3, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
              title="Open on canvas"
            >
              {'⤢'} Open on canvas
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
