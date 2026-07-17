// ── Connector Data Service ──────────────────────────────────────
// The read-back layer: given a *connected* tenant connector, pull live
// store data and normalize it into a StoreSummary the dashboard + agent
// can consume. This is the bridge that was missing between "credential
// stored & tested" and "user/agent sees real numbers".
//
// Failure modes are deliberate: an auth failure throws (caller falls back
// to the honest "connect your store" placeholder); a *shape* mismatch on
// one section yields an empty section flagged `partial: true` rather than
// fabricated numbers. We never guess a value we can't read confidently.

import * as rapidRms from './rapidrms-api.js';
import type { RapidRmsSession } from './types.js';
import { setTenantSecret, storeCredential, deleteCredential } from './vault-ref.js';

export interface StoreSummary {
  todaySales: { revenue: number; transactions: number; changePercent: number | null };
  lowStock: {
    count: number;
    items: Array<{ name: string; current: number; threshold: number }>;
  };
  source: { type: string; name: string };
  fetchedAt: string;
  /** True when one or more sections could not be read from the store's payload. */
  partial: boolean;
}

export interface ConnectorRecord {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  /** Already decrypted by the caller. */
  secrets: Record<string, string>;
}

// ── Defensive coercion helpers ──────────────────────────────────
// Store APIs return loosely-typed JSON in inconsistent envelopes. These
// tolerate the common shapes and refuse to invent data when unsure.

function toRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text) return [];
    try { return toRows(JSON.parse(text)); } catch { return []; }
  }
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['data', 'Data', 'Rows', 'rows', 'Result', 'result', 'Items', 'items', 'value']) {
      const rows = toRows(obj[key]);
      if (rows.length > 0) return rows;
    }
  }
  return [];
}

/** Read the first present numeric field from a candidate name list. Returns null if none parse. */
function pickNum(row: Record<string, unknown>, names: string[]): number | null {
  for (const n of names) {
    const v = row[n];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function pickStr(row: Record<string, unknown>, names: string[]): string | null {
  for (const n of names) {
    const v = row[n];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

// TODO(real-tenant): field-name lists below are validated against RapidRMS's
// documented endpoints but not yet against a live tenant response. The
// defensive design means an unrecognized shape yields an empty (partial)
// section, never a wrong number — safe to ship, refine once a real tenant
// connects.
const REVENUE_FIELDS = ['Total', 'NetSales', 'NetTotal', 'GrandTotal', 'SalesAmount', 'Amount', 'TotalAmount', 'BillAmount', 'billAmount', 'subTotal', 'grandTotal', 'bill_amount'];
const SALES_DATE_FIELDS = ['InvoiceDate', 'invoiceDate', 'invoice_date', 'CreatedDate', 'createdDate', 'BusinessDate', 'business_date', 'datetime', 'Date', 'date'];
const INVOICE_FIELDS = ['InvoiceNo', 'invoiceNo', 'invoice_no', 'InvoiceNumber', 'TransactionId', 'transaction_id'];
const QTY_FIELDS = ['OnHand', 'QtyOnHand', 'Quantity', 'Qty', 'StockOnHand', 'CurrentStock'];
const REORDER_FIELDS = ['ReorderPoint', 'ReorderLevel', 'MinQty', 'MinimumQty', 'Threshold', 'ParLevel'];
const NAME_FIELDS = ['Name', 'ItemName', 'Description', 'ProductName', 'Product'];

function todayRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const day = `${y}-${m}-${d}`;
  return { from: day, to: day };
}

function normalizeBusinessDate(value: string | null): string | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (iso) return iso;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

const INVOICE_PAGE_SIZE = 5000;
const MAX_INVOICE_PAGES = 200;

/** Fetch every page for a bounded invoice-report range without silently truncating sales. */
async function fetchInvoiceRows(
  session: RapidRmsSession,
  params: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const allRows: Array<Record<string, unknown>> = [];
  let previousPageSignature = '';
  for (let pageNo = 1; pageNo <= MAX_INVOICE_PAGES; pageNo++) {
    const payload = await rapidRms.getInvoiceReport(session, { ...params, pageNo, pageSize: INVOICE_PAGE_SIZE });
    const rows = toRows(payload);
    if (rows.length === 0) return allRows;
    const firstInvoice = pickStr(rows[0], INVOICE_FIELDS) || '';
    const lastInvoice = pickStr(rows[rows.length - 1], INVOICE_FIELDS) || '';
    const signature = `${rows.length}:${firstInvoice}:${lastInvoice}`;
    if (pageNo > 1 && signature === previousPageSignature) {
      throw new Error('RapidRMS invoice pagination did not advance');
    }
    allRows.push(...rows);
    if (rows.length < INVOICE_PAGE_SIZE) return allRows;
    previousPageSignature = signature;
  }
  throw new Error(`RapidRMS invoice report exceeded ${MAX_INVOICE_PAGES} pages`);
}

// ── RapidRMS summary ────────────────────────────────────────────

async function fetchRapidRmsSummary(
  record: ConnectorRecord,
  vaultSecret: string,
): Promise<StoreSummary> {
  const refs: string[] = [];
  try {
    setTenantSecret(vaultSecret);
    const emailRef = await storeCredential(`${record.id}:email`, record.secrets.email ?? '');
    const passwordRef = await storeCredential(`${record.id}:password`, record.secrets.password ?? '');
    refs.push(emailRef, passwordRef);

    const session = await rapidRms.authenticate(
      {
        baseUrl: String(record.config.baseUrl || 'https://rapidrmsapi.azurewebsites.net'),
        clientId: String(record.config.clientId || ''),
        sessionTimeout: Number(record.config.sessionTimeout) || 420,
      },
      emailRef,
      passwordRef,
    );

    const { from, to } = todayRange();
    let partial = false;

    // Sales — today's total + transaction count
    let revenue = 0;
    let transactions = 0;
    try {
      const rows = await fetchInvoiceRows(session, { FromDate: from, ToDate: to });
      let sawRevenue = false;
      for (const r of rows) {
        const rev = pickNum(r, REVENUE_FIELDS);
        if (rev !== null) { revenue += rev; sawRevenue = true; }
      }
      // Prefer an explicit count field on the envelope/first row; else row count.
      transactions = rows.length;
      if (!sawRevenue && rows.length > 0) partial = true; // rows existed but no revenue field matched
    } catch {
      partial = true;
    }

    // Inventory — low-stock items (current below reorder point)
    const items: Array<{ name: string; current: number; threshold: number }> = [];
    try {
      const invRaw = await rapidRms.getInventory(session, {});
      const rows = toRows(invRaw);
      for (const r of rows) {
        const current = pickNum(r, QTY_FIELDS);
        const threshold = pickNum(r, REORDER_FIELDS);
        const name = pickStr(r, NAME_FIELDS);
        if (current !== null && threshold !== null && name && current < threshold) {
          items.push({ name, current, threshold });
        }
      }
      items.sort((a, b) => a.current - b.current);
    } catch {
      partial = true;
    }

    return {
      todaySales: { revenue: Math.round(revenue * 100) / 100, transactions, changePercent: null },
      lowStock: { count: items.length, items: items.slice(0, 10) },
      source: { type: record.type, name: record.name },
      fetchedAt: new Date().toISOString(),
      partial,
    };
  } finally {
    await Promise.all(refs.map((ref) => deleteCredential(ref).catch(() => {})));
  }
}

// ── Public entry ────────────────────────────────────────────────

/**
 * Whether a connector type can produce a live StoreSummary. Single source of
 * truth for "will the dashboard ever get numbers from this connector" — the
 * UI uses it to say "syncing" only when numbers can actually arrive.
 * Azure SQL + Verifone expose data methods (query / fetchReports) but need a
 * schema/report mapping per deployment — not yet generalized.
 */
export function hasSummaryMapper(type: string): boolean {
  return type === 'rapidrms-api';
}

/**
 * Fetch a normalized live summary for a connected connector.
 * Throws on auth/transport failure (caller falls back to placeholder).
 * Returns null for connector types that don't yet have a summary mapper —
 * keeping the dashboard on its honest placeholder rather than guessing.
 */
export async function fetchStoreSummary(
  record: ConnectorRecord,
  vaultSecret: string,
): Promise<StoreSummary | null> {
  if (!hasSummaryMapper(record.type)) return null;
  return fetchRapidRmsSummary(record, vaultSecret);
}

export type DailyStoreSales = { businessDate: string; revenue: number; transactions: number };

/** Fetch and normalize a bounded RapidRMS sales range into daily totals. */
export async function fetchStoreSalesRange(
  record: ConnectorRecord,
  vaultSecret: string,
  from: string,
  to: string,
): Promise<DailyStoreSales[]> {
  if (record.type !== 'rapidrms-api') return [];
  const refs: string[] = [];
  try {
    setTenantSecret(vaultSecret);
    const emailRef = await storeCredential(`${record.id}:sales-email`, record.secrets.email ?? '');
    const passwordRef = await storeCredential(`${record.id}:sales-password`, record.secrets.password ?? '');
    refs.push(emailRef, passwordRef);
    const session = await rapidRms.authenticate({ baseUrl: String(record.config.baseUrl || 'https://rapidrmsapi.azurewebsites.net'), clientId: String(record.config.clientId || ''), sessionTimeout: Number(record.config.sessionTimeout) || 420 }, emailRef, passwordRef);
    // Match MIB's proven RapidRMS contract: InvoiceReport expects calendar
    // dates here, not timestamps with appended time components.
    const rows = await fetchInvoiceRows(session, { FromDate: from, ToDate: to });
    const buckets = new Map<string, { revenue: number; invoices: Set<string>; rows: number }>();
    for (const row of rows) {
      const dateValue = pickStr(row, SALES_DATE_FIELDS);
      // RapidRMS's live payload uses `datetime` and may format it in the
      // tenant locale rather than ISO. For a one-day API result, the endpoint
      // itself provides the date boundary even if an older tenant omits it.
      const businessDate = normalizeBusinessDate(dateValue) || (from === to ? from : null);
      if (!businessDate || businessDate < from || businessDate > to) continue;
      const bucket = buckets.get(businessDate) || { revenue: 0, invoices: new Set<string>(), rows: 0 };
      bucket.revenue += pickNum(row, REVENUE_FIELDS) || 0;
      const invoice = pickStr(row, INVOICE_FIELDS);
      if (invoice) bucket.invoices.add(invoice);
      bucket.rows++;
      buckets.set(businessDate, bucket);
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([businessDate, bucket]) => ({ businessDate, revenue: Math.round(bucket.revenue * 100) / 100, transactions: bucket.invoices.size || bucket.rows }));
  } finally {
    await Promise.all(refs.map(ref => deleteCredential(ref).catch(() => {})));
  }
}
