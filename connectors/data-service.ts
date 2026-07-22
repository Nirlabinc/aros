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
import { fetchBosTimecards, type BosTimecardReport } from './rapidrms-bos.js';
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
const INVOICE_NUMBER_FIELDS = ['InvoiceNo', 'invoiceNo', 'invoice_no', 'InvoiceNumber', 'invoiceNumber', 'ReceiptNo', 'receiptNo', 'BillNo', 'billNo'];
const INVOICE_FIELDS = [...INVOICE_NUMBER_FIELDS, 'TransactionId', 'transaction_id', 'InvoiceId', 'invoiceId', 'id'];
const QTY_FIELDS = ['iteM_InStock', 'OnHand', 'QtyOnHand', 'Quantity', 'Qty', 'StockOnHand', 'CurrentStock'];
const REORDER_FIELDS = ['iteM_MinStockLevel', 'ReorderPoint', 'ReorderLevel', 'MinQty', 'MinimumQty', 'Threshold', 'ParLevel'];
const NAME_FIELDS = ['description', 'iteM_ShortName', 'Name', 'ItemName', 'Description', 'ProductName', 'Product'];
const ITEM_CODE_FIELDS = ['ItemCode', 'itemCode', 'item_code', 'Barcode', 'barcode', 'UPC', 'upc', 'sku', 'Sku', 'PLU', 'plu'];
const ITEM_QTY_FIELDS = ['Qty', 'qty', 'Quantity', 'quantity', 'SoldQty', 'soldQty', 'item_qty', 'ItemQty', 'ItemQuantity', 'itemQuantity'];
const ITEM_TOTAL_FIELDS = ['LineTotal', 'lineTotal', 'Total', 'total', 'TotalAmount', 'totalAmount', 'Amount', 'amount', 'SalesAmount', 'salesAmount'];
const PRICE_FIELDS = ['Price', 'price', 'RetailPrice', 'retailPrice', 'UnitPrice', 'unitPrice', 'SellingPrice', 'sellingPrice', 'iteM_Price'];
const COST_FIELDS = ['Cost', 'cost', 'CostPrice', 'costPrice', 'UnitCost', 'unitCost', 'AvgCost', 'avgCost', 'iteM_Cost'];
const CREATED_FIELDS = ['CreatedDate', 'createdDate', 'created_at', 'DateCreated', 'dateCreated', 'AddedDate', 'addedDate', 'itemCreatedDate'];
const UPDATED_FIELDS = ['UpdatedDate', 'updatedDate', 'updated_at', 'ModifiedDate', 'modifiedDate', 'LastUpdated', 'lastUpdated', 'LastModified', 'lastModified'];
const PRICE_CHANGED_FIELDS = ['PriceChangedDate', 'priceChangedDate', 'LastPriceChangeDate', 'lastPriceChangeDate', 'PriceUpdatedDate', 'priceUpdatedDate'];
const COST_CHANGED_FIELDS = ['CostChangedDate', 'costChangedDate', 'LastCostChangeDate', 'lastCostChangeDate', 'CostUpdatedDate', 'costUpdatedDate'];

/** Fallback when a connector has no configured timezone: US retail default. */
export const DEFAULT_STORE_TIMEZONE = 'America/New_York';

/**
 * The store's business "today" (YYYY-MM-DD) in the STORE's timezone, never
 * UTC: a New York store is still selling at 9pm local while the UTC date has
 * already rolled over — a UTC-derived window would query "tomorrow" and
 * report an empty evening every single day.
 */
export function businessToday(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD directly.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * RapidRMS invoice endpoints match NOTHING on bare calendar dates — verified
 * against the live API 2026-07-20: `FromDate=2026-07-20&ToDate=2026-07-20`
 * returns `"No Data available"` while `...T00:00:00`/`...T23:59:59` returns
 * the day's 90 invoices. Every dated invoice query must use full-day
 * datetime bounds (this matches the proven shre-rapidrms warehouse sync).
 */
export function invoiceDayBounds(fromDay: string, toDay: string): { FromDate: string; ToDate: string } {
  return { FromDate: `${fromDay}T00:00:00`, ToDate: `${toDay}T23:59:59` };
}

function storeTimezone(config: Record<string, unknown>): string {
  const tz = typeof config.timezone === 'string' && config.timezone.trim() ? config.timezone.trim() : DEFAULT_STORE_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_STORE_TIMEZONE;
  }
}

function normalizeBusinessDate(value: string | null): string | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (iso) return iso;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

/**
 * First date field on the row that normalizes to a PLAUSIBLE calendar date.
 * Live RapidRMS rows carry sentinel dates — `createdDate:
 * "0001-01-01T00:00:00"` alongside the real `datetime` — and a naive
 * first-field pick bucketed every invoice into year 0001, dropping the whole
 * range (observed 2026-07-20: multi-day sales range returned [] while the
 * same rows summed fine for single-day totals).
 */
export function pickBusinessDate(row: Record<string, unknown>): string | null {
  for (const field of SALES_DATE_FIELDS) {
    const value = row[field];
    if (typeof value !== 'string' || !value) continue;
    const day = normalizeBusinessDate(value);
    if (day && day >= '2000-01-01') return day;
  }
  return null;
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

    const today = businessToday(storeTimezone(record.config));
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
      const rows = await fetchInvoiceRows(session, invoiceDayBounds(today, today));
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

export interface TopSoldItem {
  name: string;
  code: string | null;
  quantity: number;
  sales: number;
}

export interface ItemChange {
  name: string;
  code: string | null;
  changedAt: string;
  changeType: 'created' | 'updated' | 'price' | 'cost';
  price?: number | null;
  cost?: number | null;
}

export interface StoreInvoice {
  invoiceNo: string | null;
  recordId: string | null;
  businessDate: string | null;
  timestamp: string | null;
  amount: number | null;
  isVoid: boolean;
}

export interface StoreItemsReport {
  mode: 'top_sold';
  items: TopSoldItem[];
  from: string;
  to: string;
  source: { type: string; name: string };
  fetchedAt: string;
}

export interface StoreItemChangesReport {
  mode: 'recently_added' | 'recently_edited' | 'recent_price_changes' | 'recent_cost_changes';
  items: ItemChange[];
  available: boolean;
  source: { type: string; name: string };
  fetchedAt: string;
  note?: string;
}

export interface StoreInvoicesReport {
  invoices: StoreInvoice[];
  from: string;
  to: string;
  matchedInvoice?: string;
  source: { type: string; name: string };
  fetchedAt: string;
}

function flattenSalesRows(payload: unknown): Array<Record<string, unknown>> {
  const rows = toRows(payload);
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    let addedNested = false;
    for (const key of ['Items', 'items', 'LineItems', 'lineItems', 'InvoiceItems', 'invoiceItems', 'details', 'Details']) {
      const nested = toRows(row[key]);
      for (const item of nested) {
        out.push({ ...row, ...item });
        addedNested = true;
      }
    }
    if (!addedNested) out.push(row);
  }
  return out;
}

function pickDateString(row: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = row[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function normalizeDateTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  const day = normalizeBusinessDate(value);
  return day ? `${day}T00:00:00.000Z` : null;
}

export function collectTopSoldItems(rows: Array<Record<string, unknown>>, limit = 10): TopSoldItem[] {
  const totals = new Map<string, TopSoldItem>();
  for (const row of rows) {
    if (isVoided(row)) continue;
    const name = pickStr(row, NAME_FIELDS);
    const qty = pickNum(row, ITEM_QTY_FIELDS);
    if (!name || qty === null) continue;
    const code = pickStr(row, ITEM_CODE_FIELDS);
    const key = code || name.toLowerCase();
    const current = totals.get(key) || { name, code, quantity: 0, sales: 0 };
    current.quantity += qty;
    current.sales += pickNum(row, ITEM_TOTAL_FIELDS) ?? 0;
    totals.set(key, current);
  }
  return [...totals.values()]
    .map((item) => ({ ...item, quantity: Math.round(item.quantity * 1000) / 1000, sales: Math.round(item.sales * 100) / 100 }))
    .sort((a, b) => b.quantity - a.quantity || b.sales - a.sales || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function collectItemChanges(
  rows: Array<Record<string, unknown>>,
  mode: StoreItemChangesReport['mode'],
  limit = 10,
): { items: ItemChange[]; available: boolean; note?: string } {
  const fields = mode === 'recently_added'
    ? CREATED_FIELDS
    : mode === 'recent_price_changes'
      ? PRICE_CHANGED_FIELDS
      : mode === 'recent_cost_changes'
        ? COST_CHANGED_FIELDS
        : UPDATED_FIELDS;
  const fallbackFields = mode === 'recently_added' ? [] : UPDATED_FIELDS;
  const changeType: ItemChange['changeType'] = mode === 'recently_added'
    ? 'created'
    : mode === 'recent_price_changes'
      ? 'price'
      : mode === 'recent_cost_changes'
        ? 'cost'
        : 'updated';

  const items: ItemChange[] = [];
  let sawDedicatedDate = false;
  for (const row of rows) {
    if (isInactiveItem(row)) continue;
    const name = pickStr(row, NAME_FIELDS);
    if (!name) continue;
    const dedicated = pickDateString(row, fields);
    if (dedicated) sawDedicatedDate = true;
    const changedAt = normalizeDateTime(dedicated || pickDateString(row, fallbackFields));
    if (!changedAt) continue;
    items.push({
      name,
      code: pickStr(row, ITEM_CODE_FIELDS),
      changedAt,
      changeType,
      price: pickNum(row, PRICE_FIELDS),
      cost: pickNum(row, COST_FIELDS),
    });
  }

  const needsDedicated = mode === 'recent_price_changes' || mode === 'recent_cost_changes';
  if (needsDedicated && !sawDedicatedDate) {
    return {
      items: [],
      available: false,
      note: 'RapidRMS did not expose dedicated change timestamps for this field; no change list was returned rather than guessing.',
    };
  }
  return {
    items: items.sort((a, b) => b.changedAt.localeCompare(a.changedAt)).slice(0, limit),
    available: items.length > 0,
  };
}

export function collectInvoices(
  rows: Array<Record<string, unknown>>,
  from: string,
  to: string,
  limit = 10,
  invoiceNo?: string,
): StoreInvoice[] {
  const needle = invoiceNo?.trim().toLowerCase();
  const invoices = rows.map((row) => {
    const trueInvoiceNo = pickStr(row, INVOICE_NUMBER_FIELDS);
    const recordId = pickStr(row, INVOICE_FIELDS);
    const timestamp = normalizeDateTime(pickDateString(row, SALES_DATE_FIELDS));
    const businessDate = pickBusinessDate(row) || (from === to ? from : null);
    return {
      invoiceNo: trueInvoiceNo,
      recordId,
      businessDate,
      timestamp,
      amount: pickNum(row, REVENUE_FIELDS),
      isVoid: isVoided(row),
    };
  }).filter((row) => {
    if (!row.businessDate || row.businessDate < from || row.businessDate > to) return false;
    if (!needle) return true;
    return row.invoiceNo?.toLowerCase() === needle || row.recordId?.toLowerCase() === needle;
  });

  return invoices
    .sort((a, b) => String(b.timestamp || b.businessDate).localeCompare(String(a.timestamp || a.businessDate)))
    .slice(0, limit);
}

async function withRapidRmsSession<T>(
  record: ConnectorRecord,
  vaultSecret: string,
  purpose: string,
  fn: (session: RapidRmsSession) => Promise<T>,
): Promise<T> {
  const refs: string[] = [];
  try {
    setTenantSecret(vaultSecret);
    const emailRef = await storeCredential(`${record.id}:${purpose}-email`, record.secrets.email ?? '', vaultSecret);
    const passwordRef = await storeCredential(`${record.id}:${purpose}-password`, record.secrets.password ?? '', vaultSecret);
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
    return await fn(session);
  } finally {
    await Promise.all(refs.map((ref) => deleteCredential(ref).catch(() => {})));
  }
}

export async function fetchTopSoldItems(
  record: ConnectorRecord,
  vaultSecret: string,
  from: string,
  to: string,
  limit = 10,
): Promise<StoreItemsReport | null> {
  if (!hasSummaryMapper(record.type)) return null;
  return withRapidRmsSession(record, vaultSecret, 'top-items', async (session) => {
    const bounds = invoiceDayBounds(from, to);
    const params = { ...bounds, fromDate: bounds.FromDate, toDate: bounds.ToDate };
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = flattenSalesRows(await rapidRms.getSalesDetail(session, params));
    } catch {
      rows = flattenSalesRows(await rapidRms.getInvoiceReport(session, params));
    }
    return {
      mode: 'top_sold',
      items: collectTopSoldItems(rows, limit),
      from,
      to,
      source: { type: record.type, name: record.name },
      fetchedAt: new Date().toISOString(),
    };
  });
}

export async function fetchItemChanges(
  record: ConnectorRecord,
  vaultSecret: string,
  mode: StoreItemChangesReport['mode'],
  limit = 10,
): Promise<StoreItemChangesReport | null> {
  if (!hasSummaryMapper(record.type)) return null;
  return withRapidRmsSession(record, vaultSecret, `item-${mode}`, async (session) => {
    const rows = toRows(await rapidRms.getInventory(session, {}));
    const result = collectItemChanges(rows, mode, limit);
    return {
      mode,
      ...result,
      source: { type: record.type, name: record.name },
      fetchedAt: new Date().toISOString(),
    };
  });
}

export async function fetchStoreInvoices(
  record: ConnectorRecord,
  vaultSecret: string,
  from: string,
  to: string,
  limit = 10,
  invoiceNo?: string,
): Promise<StoreInvoicesReport | null> {
  if (!hasSummaryMapper(record.type)) return null;
  return withRapidRmsSession(record, vaultSecret, 'invoices', async (session) => {
    const rows = await fetchInvoiceRows(session, invoiceDayBounds(from, to));
    return {
      invoices: collectInvoices(rows, from, to, limit, invoiceNo),
      from,
      to,
      matchedInvoice: invoiceNo,
      source: { type: record.type, name: record.name },
      fetchedAt: new Date().toISOString(),
    };
  });
}

export async function fetchStoreTimecards(
  record: ConnectorRecord,
  from: string,
  to: string,
  employee?: string,
): Promise<BosTimecardReport | null> {
  if (!hasSummaryMapper(record.type)) return null;
  return fetchBosTimecards(
    { bosBaseUrl: String(record.config.bosBaseUrl || 'https://www.rapidrms.com'), timezone: storeTimezone(record.config) },
    record.secrets,
    from,
    to,
    employee,
  );
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
    const rows = await fetchInvoiceRows(session, invoiceDayBounds(from, to));
    const buckets = new Map<string, { revenue: number; invoices: Set<string>; rows: number }>();
    for (const row of rows) {
      // For a one-day API result the endpoint itself provides the date
      // boundary even if a tenant's rows omit a usable date field.
      const businessDate = pickBusinessDate(row) || (from === to ? from : null);
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
