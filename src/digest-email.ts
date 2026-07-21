/**
 * Weekly Brief email formatting — pure (no I/O), unit-testable.
 * Turns the owner-digest JSON (shre-rapidrms /api/digest/latest shape) into
 * a plain-text email a store owner reads in 30 seconds. Sections render only
 * when they have content; an empty digest yields null (nothing to send —
 * never an empty email).
 */

interface DigestReorderRow {
  name?: string; qty_on_hand?: number; suggested_qty?: number;
  est_reorder_cost?: number; stock_status?: string;
}
interface DigestAttachRow {
  name_a?: string; name_b?: string; attach_rate?: number; together?: number;
}
export interface DigestBody {
  period_end?: string;
  cadence?: string;
  digest?: {
    period?: { end?: string; window_days?: number };
    reorder?: DigestReorderRow[];
    attach?: DigestAttachRow[];
    notes?: unknown[];
  } | null;
}

const money = (v: number | undefined) => (v == null ? '' : `$${v.toFixed(2)}`);

/** Daily sales summary — one glance at yesterday. Null when the day had no
 * rows at all (fetch failed upstream); a genuine $0 day still sends. */
export function formatDailySales(storeName: string, day: string, sales: { revenue: number; transactions: number } | null): { subject: string; text: string } | null {
  if (!sales) return null;
  return {
    subject: `${storeName} yesterday: ${money(sales.revenue)} across ${sales.transactions} transactions`,
    text: [
      `${storeName} — ${day}`,
      '',
      `Revenue: ${money(sales.revenue)}`,
      `Transactions: ${sales.transactions}`,
      `Average ticket: ${sales.transactions > 0 ? money(sales.revenue / sales.transactions) : '—'}`,
      '',
      'Full picture: https://app.aros.live/dashboard',
    ].join('\n'),
  };
}

/** Low-stock alert — only when something is actually low. */
export function formatLowStock(storeName: string, items: Array<{ name: string; current: number; threshold: number }>): { subject: string; text: string } | null {
  if (items.length === 0) return null;
  return {
    subject: `${storeName}: ${items.length} item${items.length === 1 ? '' : 's'} at or below reorder point`,
    text: [
      `Low stock at ${storeName}:`,
      '',
      ...items.slice(0, 12).map((i) => `• ${i.name.trim()} — ${i.current} on hand (reorder at ${i.threshold})`),
      ...(items.length > 12 ? [`…and ${items.length - 12} more`] : []),
      '',
      'Review inventory: https://app.aros.live/dashboard',
    ].join('\n'),
  };
}

export function formatWeeklyBrief(storeName: string, body: DigestBody): { subject: string; text: string; periodEnd: string } | null {
  const digest = body.digest;
  const periodEnd = body.period_end || digest?.period?.end || '';
  if (!digest || !periodEnd) return null;

  const sections: string[] = [];

  const reorder = (digest.reorder || []).filter((r) => r.name).slice(0, 8);
  if (reorder.length) {
    sections.push([
      'REORDER SUGGESTIONS',
      ...reorder.map((r) => {
        const status = r.stock_status === 'out_of_stock' ? 'OUT OF STOCK' : `${r.qty_on_hand ?? '?'} on hand`;
        const cost = r.est_reorder_cost ? ` (~${money(r.est_reorder_cost)})` : '';
        return `• ${(r.name || '').trim()} — ${status}, suggest ${r.suggested_qty ?? '?'}${cost}`;
      }),
    ].join('\n'));
  }

  const attach = (digest.attach || []).filter((a) => a.name_a && a.name_b).slice(0, 5);
  if (attach.length) {
    sections.push([
      'BOUGHT TOGETHER',
      ...attach.map((a) => `• ${(a.name_a || '').trim()} + ${(a.name_b || '').trim()} — ${Math.round((a.attach_rate || 0) * 100)}% attach (${a.together ?? '?'}× this period)`),
    ].join('\n'));
  }

  if (sections.length === 0) return null;

  const windowDays = digest.period?.window_days ?? 7;
  return {
    subject: `Weekly Brief — ${storeName} (week ending ${periodEnd})`,
    periodEnd,
    text: [
      `Your ${windowDays}-day brief for ${storeName}, week ending ${periodEnd}.`,
      '',
      sections.join('\n\n'),
      '',
      'Open the full brief: https://app.aros.live/dashboard',
    ].join('\n'),
  };
}
