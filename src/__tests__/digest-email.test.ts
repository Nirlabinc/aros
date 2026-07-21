/**
 * Weekly Brief formatter: real digest shape in, readable email out; empty
 * digests yield null (never an empty send).
 */
import { describe, expect, it } from 'vitest';
import { formatWeeklyBrief, formatDailySales, formatLowStock } from '../digest-email';

const REAL_SHAPE = {
  provider: 'rapidrms', store_id: 'client-2', period_end: '2026-07-20', cadence: 'weekly',
  digest: {
    period: { end: '2026-07-20', window_days: 7 },
    reorder: [
      { upc: '018200069918', name: 'MICHELOB ALTRA 12 CAN', qty_on_hand: 0, stock_status: 'out_of_stock', suggested_qty: 23, est_reorder_cost: 316.71 },
      { upc: 'x', name: 'TITOS 750', qty_on_hand: 3, stock_status: 'low', suggested_qty: 12 },
    ],
    attach: [
      { lift: 448.2, name_a: 'LIBERTY CREEK MOSCATO 1.5', name_b: 'LIBERTY CREEK PINTO NOIR 1.5', together: 33, attach_rate: 0.917 },
    ],
    notes: [],
  },
};

describe('formatWeeklyBrief', () => {
  it('formats the real digest shape into subject + sections', () => {
    const out = formatWeeklyBrief('Party Liquor', REAL_SHAPE as never);
    expect(out).not.toBeNull();
    expect(out?.subject).toBe('Weekly Brief — Party Liquor (week ending 2026-07-20)');
    expect(out?.periodEnd).toBe('2026-07-20');
    expect(out?.text).toContain('MICHELOB ALTRA 12 CAN — OUT OF STOCK, suggest 23 (~$316.71)');
    expect(out?.text).toContain('TITOS 750 — 3 on hand, suggest 12');
    expect(out?.text).toContain('LIBERTY CREEK MOSCATO 1.5 + LIBERTY CREEK PINTO NOIR 1.5 — 92% attach (33× this period)');
  });

  it('returns null when there is nothing to say', () => {
    expect(formatWeeklyBrief('S', { period_end: '2026-07-20', digest: { period: { end: '2026-07-20' }, reorder: [], attach: [] } })).toBeNull();
    expect(formatWeeklyBrief('S', { digest: null })).toBeNull();
  });
});

describe('formatDailySales', () => {
  it('formats a real day and keeps genuine $0 days', () => {
    const out = formatDailySales('Party Liquor', '2026-07-20', { revenue: 956.36, transactions: 66 });
    expect(out?.subject).toBe('Party Liquor yesterday: $956.36 across 66 transactions');
    expect(out?.text).toContain('Average ticket: $14.49');
    expect(formatDailySales('S', '2026-07-20', { revenue: 0, transactions: 0 })).not.toBeNull();
  });
  it('returns null when the day could not be read', () => {
    expect(formatDailySales('S', '2026-07-20', null)).toBeNull();
  });
});

describe('formatLowStock', () => {
  it('lists items and caps at 12', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ name: `ITEM ${i}`, current: 0, threshold: 2 }));
    const out = formatLowStock('Party Liquor', items);
    expect(out?.subject).toContain('15 items');
    expect(out?.text).toContain('…and 3 more');
  });
  it('never sends for an empty list', () => {
    expect(formatLowStock('S', [])).toBeNull();
  });
});
