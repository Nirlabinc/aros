/**
 * RapidRMS dated-query contract — pins the two failure modes that made every
 * sales number read zero while the store was actively selling:
 *
 * 1. Bare calendar dates match NOTHING on the live invoice endpoints
 *    (verified 2026-07-20: `FromDate=2026-07-20&ToDate=2026-07-20` →
 *    "No Data available"; datetime bounds → the day's 90 invoices). Bounds
 *    must always carry T00:00:00 / T23:59:59.
 * 2. "Today" computed from the UTC clock rolls a day ahead of a US store
 *    every evening (8pm ET onward), silently querying an empty tomorrow.
 */
import { describe, expect, it } from 'vitest';
import { businessToday, invoiceDayBounds, pickBusinessDate, DEFAULT_STORE_TIMEZONE } from '../../connectors/data-service';

describe('invoiceDayBounds', () => {
  it('always emits full-day datetime bounds, never bare dates', () => {
    expect(invoiceDayBounds('2026-07-20', '2026-07-20')).toEqual({
      FromDate: '2026-07-20T00:00:00',
      ToDate: '2026-07-20T23:59:59',
    });
  });

  it('spans multi-day ranges from first midnight to last end-of-day', () => {
    expect(invoiceDayBounds('2026-07-14', '2026-07-20')).toEqual({
      FromDate: '2026-07-14T00:00:00',
      ToDate: '2026-07-20T23:59:59',
    });
  });
});

describe('businessToday', () => {
  // 2026-07-21T01:30:00Z = 9:30pm 2026-07-20 in New York: the store is still
  // open and mid-evening-rush while UTC has already moved to the 21st.
  const eveningRush = new Date('2026-07-21T01:30:00Z');

  it("uses the store's date, not the UTC date, during the evening rollover window", () => {
    expect(businessToday('America/New_York', eveningRush)).toBe('2026-07-20');
  });

  it('formats as YYYY-MM-DD', () => {
    expect(businessToday(DEFAULT_STORE_TIMEZONE, new Date('2026-07-20T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('pickBusinessDate', () => {
  it('skips sentinel dates and uses the real datetime — the live-row shape', () => {
    // Real invoice row shape observed 2026-07-20: createdDate is a 0001-01-01
    // sentinel; the true sale time lives in `datetime`. createdDate is
    // checked first in SALES_DATE_FIELDS, so without plausibility filtering
    // every row bucketed into year 0001 and the whole range dropped.
    expect(pickBusinessDate({ createdDate: '0001-01-01T00:00:00', datetime: '2026-07-19T12:04:39' })).toBe('2026-07-19');
  });

  it('returns null when no plausible date exists', () => {
    expect(pickBusinessDate({ createdDate: '0001-01-01T00:00:00', invoiceNo: 'A1' })).toBeNull();
  });
});
