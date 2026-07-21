import { describe, expect, it } from 'vitest';
import {
  collectInventoryRisks,
  computeVoidExceptions,
  fetchExceptionSummary,
  fetchInventoryRisks,
  EXCEPTION_SUPPORTED_TYPES,
  EXCEPTION_UNSUPPORTED_TYPES,
} from '../../connectors/data-service.js';

// The data layer behind /api/store/inventory-risks and /api/store/exceptions
// (the routes that make aros_get_inventory_risks / aros_get_exception_summary
// real). Row shapes below use the live-verified RapidRMS field names
// (iteM_InStock / iteM_MinStockLevel / description; invoice isVoid).

describe('collectInventoryRisks', () => {
  it('classifies stockout vs low_stock against configured reorder points, sorted worst-first', () => {
    const risks = collectInventoryRisks([
      { description: 'Energy drink', iteM_InStock: 2, iteM_MinStockLevel: 5 },
      { description: '24-pack water', iteM_InStock: 0, iteM_MinStockLevel: 3 },
      { description: 'Fully stocked', iteM_InStock: 50, iteM_MinStockLevel: 10 },
    ]);
    expect(risks).toEqual([
      { name: '24-pack water', current: 0, threshold: 3, risk: 'stockout' },
      { name: 'Energy drink', current: 2, threshold: 5, risk: 'low_stock' },
    ]);
  });

  it('never flags items without a configured (>0) reorder point', () => {
    const risks = collectInventoryRisks([
      { description: 'No threshold', iteM_InStock: 0 },
      { description: 'Zero threshold', iteM_InStock: 0, iteM_MinStockLevel: 0 },
    ]);
    expect(risks).toEqual([]);
  });

  it('skips deleted and inactive catalog entries', () => {
    const risks = collectInventoryRisks([
      { description: 'Deleted', iteM_InStock: 0, iteM_MinStockLevel: 5, isDeleted: true },
      { description: 'Inactive', iteM_InStock: 0, iteM_MinStockLevel: 5, active: false },
      { description: 'Live', iteM_InStock: 1, iteM_MinStockLevel: 5, active: true },
    ]);
    expect(risks).toEqual([{ name: 'Live', current: 1, threshold: 5, risk: 'low_stock' }]);
  });

  it('yields nothing (rather than inventing data) for unrecognized row shapes', () => {
    expect(collectInventoryRisks([{ foo: 'bar' }, { baz: 1 }])).toEqual([]);
  });

  it('tolerates alternate field spellings', () => {
    const risks = collectInventoryRisks([
      { Name: 'Alt fields', OnHand: '1', ReorderPoint: '4' },
    ]);
    expect(risks).toEqual([{ name: 'Alt fields', current: 1, threshold: 4, risk: 'low_stock' }]);
  });
});

describe('computeVoidExceptions', () => {
  it('counts only voided invoices, bucketed by business date', () => {
    const { totals, daily, partial } = computeVoidExceptions([
      { datetime: '2026-07-18T10:00:00', Total: 10.5, isVoid: true },
      { datetime: '2026-07-18T11:00:00', Total: 99.99, isVoid: false },
      { datetime: '2026-07-19T09:00:00', Total: 4.25, isVoid: 1 },
      { datetime: '2026-07-19T09:30:00', Total: 1.0, IsVoid: '1' },
    ], '2026-07-18', '2026-07-19');
    expect(totals.void).toEqual({ count: 3, amount: 15.75 });
    expect(daily).toEqual([
      { businessDate: '2026-07-18', count: 1, amount: 10.5 },
      { businessDate: '2026-07-19', count: 2, amount: 5.25 },
    ]);
    expect(partial).toBe(false);
  });

  it('excludes voids outside the requested range', () => {
    const { totals } = computeVoidExceptions([
      { datetime: '2026-07-10T10:00:00', Total: 3, isVoid: true },
      { datetime: '2026-07-18T10:00:00', Total: 7, isVoid: true },
    ], '2026-07-18', '2026-07-18');
    expect(totals.void).toEqual({ count: 1, amount: 7 });
  });

  it('falls back to the range date for a single-day query when rows carry no date', () => {
    const { totals, daily } = computeVoidExceptions([
      { Total: 2.5, isVoid: true },
    ], '2026-07-18', '2026-07-18');
    expect(totals.void.count).toBe(1);
    expect(daily).toEqual([{ businessDate: '2026-07-18', count: 1, amount: 2.5 }]);
  });

  it('drops undateable rows in multi-day ranges instead of guessing a day', () => {
    const { totals } = computeVoidExceptions([
      { Total: 2.5, isVoid: true },
    ], '2026-07-17', '2026-07-18');
    expect(totals.void.count).toBe(0);
  });

  it('marks the summary partial when a voided row has no parsable amount', () => {
    const { totals, partial } = computeVoidExceptions([
      { datetime: '2026-07-18T10:00:00', isVoid: true },
      { datetime: '2026-07-18T11:00:00', Total: 5, isVoid: true },
    ], '2026-07-18', '2026-07-18');
    expect(totals.void).toEqual({ count: 2, amount: 5 });
    expect(partial).toBe(true);
  });

  it('declares exactly which exception types the data source supports', () => {
    expect([...EXCEPTION_SUPPORTED_TYPES]).toEqual(['void']);
    expect([...EXCEPTION_UNSUPPORTED_TYPES]).toEqual(['refund', 'no_sale', 'cashier']);
  });
});

describe('connector types without a data mapper degrade to null (no fabrication)', () => {
  const record = (type: string) => ({
    id: 'conn-x', type, name: 'Other store', config: {}, secrets: {},
  });

  it('fetchInventoryRisks returns null for verifone', async () => {
    await expect(fetchInventoryRisks(record('verifone-commander'), 'secret')).resolves.toBeNull();
  });

  it('fetchExceptionSummary returns null for azure-db', async () => {
    await expect(fetchExceptionSummary(record('azure-db'), 'secret', '2026-07-18', '2026-07-18')).resolves.toBeNull();
  });
});
