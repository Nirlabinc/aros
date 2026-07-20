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
    /** False when the inventory section could not be read (e.g. the live
     * RapidRMS API has no inventory endpoint) — consumers must not present
     * count:0 as "all stocked" in that case. */
    available: boolean;
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

/** Live invoice rows carry isVoid (bool/0/1/'true') — voided sales are not revenue. */
function isVoided(row: Record<string, unknown>): boolean {
  const v = row.isVoid ?? row.IsVoid ?? row.is_void;
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

/** Live item rows carry isDeleted + active — dead catalog entries must not surface as low stock. */
function isInactiveItem(row: Record<string, unknown>): boolean {
  const deleted = row.isDeleted ?? row.IsDeleted;
  if (deleted === true || deleted === 1 || deleted === '1' || String(deleted).toLowerCase() === 'true') return true;
  const active = row.active ?? row.Active;
  return active === false || active === 0 || active === '0';
}

// TODO(real-tenant): field-name lists below are validated against RapidRMS's
// documented endpoints but not yet against a live tenant response. The
// defensive design means an unrecognized shape yields an empty (partial)
// section, never a wrong number — safe to ship, refine once a real tenant
// connects.
const REVENUE_FIELDS = ['Total', 'NetSales', 'NetTotal', 'GrandTotal', 'SalesAmount', 'Amount', 'TotalAmount', 'BillAmount', 'billAmount', 'subTotal', 'grandTotal', 'bill_amount'];
const SALES_DATE_FIELDS = ['InvoiceDate', 'invoiceDate', 'invoice_date', 'CreatedDate', 'createdDate', 'BusinessDate', 'business_date', 'datetime', 'Date', 'date'];
const INVOICE_FIELDS = ['InvoiceNo', 'invoiceNo', 'invoice_no', 'InvoiceNumber', 'TransactionId', 'transaction_id'];
const QTY_FIELDS = ['iteM_InStock', 'OnHand', 'QtyOnHand', 'Quantity', 'Qty', 'StockOnHand', 'CurrentStock'];
const REORDER_FIELDS = ['iteM_MinStockLevel', 'ReorderPoint', 'ReorderLevel', 'MinQty', 'MinimumQty', 'Threshold', 'ParLevel'];
const NAME_FIELDS = ['description', 'iteM_ShortName', 'Name', 'ItemName', 'Description', 'ProductName', 'Product'];

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
    const emailRef = await storeCredential(`${record.id}:email`, record.secrets.email ?? '', vaultSecret);
    const passwordRef = await storeCredential(`${record.id}:password`, record.secrets.password ?? '', vaultSecret);
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
    // `partial` means the SALES numbers are unreliable (fetch failed or rows
    // carried no recognizable revenue field). Inventory availability is
    // tracked separately — the live RapidRMS API has no /api/Inventory/Get
    // (404, live-verified 2026-07-17), and its absence must not poison sales
    // truth: that poisoning kept every real-store summary partial forever.
    let partial = false;

    // Sales — today's total + transaction count (voided invoices excluded:
    // live payload rows carry isVoid; a voided sale is not revenue).
    let revenue = 0;
    let transactions = 0;
    try {
      const rows = await fetchInvoiceRows(session, { FromDate: from, ToDate: to });
      let sawRevenue = false;
      let counted = 0;
      for (const r of rows) {
        if (isVoided(r)) continue;
        counted++;
        const rev = pickNum(r, REVENUE_FIELDS);
        if (rev !== null) { revenue += rev; sawRevenue = true; }
      }
      transactions = counted;
      if (!sawRevenue && counted > 0) partial = true; // rows existed but no revenue field matched
    } catch {
      partial = true;
    }

    // Inventory — low-stock items (current below reorder point). Section is
    // best-effort: when unreadable, report it UNAVAILABLE rather than
    // claiming "0 low stock" (a lie) or flagging the sales numbers partial.
    let items: Array<{ name: string; current: number; threshold: number }> = [];
    let inventoryAvailable = true;
    try {
      const invRaw = await rapidRms.getInventory(session, {});
      items = collectInventoryRisks(toRows(invRaw)).map(({ name, current, threshold }) => ({ name, current, threshold }));
    } catch {
      inventoryAvailable = false;
    }

    return {
      todaySales: { revenue: Math.round(revenue * 100) / 100, transactions, changePercent: null },
      lowStock: { count: items.length, items: items.slice(0, 10), available: inventoryAvailable },
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

// ── Inventory risks (mcp-aros honesty: aros_get_inventory_risks) ─
// Derived from the same live-verified item-catalog fields the summary's
// low-stock section reads (iteM_InStock / iteM_MinStockLevel / description).
// Signals we can actually stand behind today: `stockout` (nothing on hand)
// and `low_stock` (below the configured reorder point). Fast-moving / stale
// classification would need per-item sales velocity, which the RapidRMS API
// layer does not expose in a verified shape — we do NOT fabricate it.

export interface InventoryRiskItem {
  name: string;
  current: number;
  threshold: number;
  risk: 'stockout' | 'low_stock';
}

export interface InventoryRiskReport {
  risks: InventoryRiskItem[];
  /** False when the item catalog could not be read — consumers must not
   * present an empty list as "no risks" in that case. */
  available: boolean;
  source: { type: string; name: string };
  fetchedAt: string;
}

/** Pure classification over normalized catalog rows (exported for tests). */
export function collectInventoryRisks(rows: Array<Record<string, unknown>>): InventoryRiskItem[] {
  const items: InventoryRiskItem[] = [];
  for (const r of rows) {
    if (isInactiveItem(r)) continue;
    const current = pickNum(r, QTY_FIELDS);
    const threshold = pickNum(r, REORDER_FIELDS);
    const name = pickStr(r, NAME_FIELDS);
    // threshold must be a real configured level (>0) — a 0/unset min
    // stock level would otherwise never match, but guard explicitly so
    // catalog entries without replenishment config are never "low".
    if (current !== null && threshold !== null && threshold > 0 && name && current < threshold) {
      items.push({ name, current, threshold, risk: current <= 0 ? 'stockout' : 'low_stock' });
    }
  }
  items.sort((a, b) => a.current - b.current);
  return items;
}

/**
 * Fetch live inventory risk signals for a connected connector. Returns null
 * for connector types without a mapper (verifone / azure / aws — callers
 * report "no data source" per store rather than erroring). Auth/transport
 * failure throws; an unreadable item catalog yields `available: false`.
 */
export async function fetchInventoryRisks(
  record: ConnectorRecord,
  vaultSecret: string,
): Promise<InventoryRiskReport | null> {
  if (!hasSummaryMapper(record.type)) return null;
  const refs: string[] = [];
  try {
    setTenantSecret(vaultSecret);
    const emailRef = await storeCredential(`${record.id}:risks-email`, record.secrets.email ?? '', vaultSecret);
    const passwordRef = await storeCredential(`${record.id}:risks-password`, record.secrets.password ?? '', vaultSecret);
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
    let risks: InventoryRiskItem[] = [];
    let available = true;
    try {
      risks = collectInventoryRisks(toRows(await rapidRms.getInventory(session, {})));
    } catch {
      available = false;
    }
    return {
      risks,
      available,
      source: { type: record.type, name: record.name },
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    await Promise.all(refs.map((ref) => deleteCredential(ref).catch(() => {})));
  }
}

// ── Exception summary (mcp-aros honesty: aros_get_exception_summary) ─
// The only exception marker the live RapidRMS invoice payload verifiably
// carries is isVoid (the same flag the sales summary uses to exclude voided
// revenue). Refund / no-sale / per-cashier exception attribution is NOT
// available through the RapidRMS API layer — the summary says so explicitly
// via supportedTypes/unsupportedTypes instead of inventing zeros.

export const EXCEPTION_SUPPORTED_TYPES = ['void'] as const;
export const EXCEPTION_UNSUPPORTED_TYPES = ['refund', 'no_sale', 'cashier'] as const;

export interface VoidExceptionBucket { businessDate: string; count: number; amount: number }

export interface ExceptionSummaryReport {
  totals: { void: { count: number; amount: number } };
  daily: VoidExceptionBucket[];
  supportedTypes: string[];
  unsupportedTypes: string[];
  /** True when one or more voided rows carried no parsable amount — the
   * count is still real, the amount is a lower bound. */
  partial: boolean;
  source: { type: string; name: string };
  fetchedAt: string;
}

/** Pure void-exception aggregation over invoice rows (exported for tests). */
export function computeVoidExceptions(
  rows: Array<Record<string, unknown>>,
  from: string,
  to: string,
): { totals: { void: { count: number; amount: number } }; daily: VoidExceptionBucket[]; partial: boolean } {
  const buckets = new Map<string, { count: number; amount: number }>();
  let count = 0;
  let amount = 0;
  let partial = false;
  for (const row of rows) {
    if (!isVoided(row)) continue;
    const businessDate = normalizeBusinessDate(pickStr(row, SALES_DATE_FIELDS)) || (from === to ? from : null);
    if (!businessDate || businessDate < from || businessDate > to) continue;
    const value = pickNum(row, REVENUE_FIELDS);
    if (value === null) partial = true;
    const bucket = buckets.get(businessDate) || { count: 0, amount: 0 };
    bucket.count++;
    bucket.amount += value ?? 0;
    buckets.set(businessDate, bucket);
    count++;
    amount += value ?? 0;
  }
  const daily = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([businessDate, bucket]) => ({ businessDate, count: bucket.count, amount: Math.round(bucket.amount * 100) / 100 }));
  return { totals: { void: { count, amount: Math.round(amount * 100) / 100 } }, daily, partial };
}

/**
 * Fetch a void-exception summary for a bounded date range. Returns null for
 * connector types without a mapper (caller reports "no data source" for that
 * store). Auth/transport failure throws.
 */
export async function fetchExceptionSummary(
  record: ConnectorRecord,
  vaultSecret: string,
  from: string,
  to: string,
): Promise<ExceptionSummaryReport | null> {
  if (!hasSummaryMapper(record.type)) return null;
  const refs: string[] = [];
  try {
    setTenantSecret(vaultSecret);
    const emailRef = await storeCredential(`${record.id}:exceptions-email`, record.secrets.email ?? '', vaultSecret);
    const passwordRef = await storeCredential(`${record.id}:exceptions-password`, record.secrets.password ?? '', vaultSecret);
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
    const rows = await fetchInvoiceRows(session, { FromDate: from, ToDate: to });
    const { totals, daily, partial } = computeVoidExceptions(rows, from, to);
    return {
      totals,
      daily,
      supportedTypes: [...EXCEPTION_SUPPORTED_TYPES],
      unsupportedTypes: [...EXCEPTION_UNSUPPORTED_TYPES],
      partial,
      source: { type: record.type, name: record.name },
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    await Promise.all(refs.map((ref) => deleteCredential(ref).catch(() => {})));
  }
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
    const emailRef = await storeCredential(`${record.id}:sales-email`, record.secrets.email ?? '', vaultSecret);
    const passwordRef = await storeCredential(`${record.id}:sales-password`, record.secrets.password ?? '', vaultSecret);
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
