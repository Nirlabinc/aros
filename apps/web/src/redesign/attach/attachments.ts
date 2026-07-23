// Functional core for rich chat attachments (photo · file · camera · barcode).
// Pure, framework-free, DOM-free — unit-tested with plain asserts. The React
// components and browser APIs (FileReader, canvas, camera, BarcodeDetector)
// live in the imperative shell (encode.ts, AttachSheet.tsx, BarcodeScanner.tsx).

/** Router caps: 10MB per file, 20MB per turn (see mission contract Shared S). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TURN_BYTES = 20 * 1024 * 1024;
/** Large images are downscaled client-side before base64 encoding. */
export const IMAGE_MAX_DIM = 2000;

/** MIME allowlist — images the vision model reads, plus documents the router
 *  text-extracts (PDF/DOCX/XLSX/PPTX). Anything else is rejected before encode. */
export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
export const DOC_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
];
export const ATTACH_ACCEPT = [...IMAGE_MIME, ...DOC_MIME].join(',');

/** One attachment as sent to the router: { name, type, dataUrl }. `size` is the
 *  decoded byte count, carried locally for cap math and never sent on the wire. */
export interface Attachment {
  name: string;
  type: string;
  dataUrl: string;
  size: number;
}

/** The wire shape — mission contract: attachments:[{name,type,dataUrl}]. */
export function toWire(a: Attachment): { name: string; type: string; dataUrl: string } {
  return { name: a.name, type: a.type, dataUrl: a.dataUrl };
}

export function isImage(type: string): boolean {
  return IMAGE_MIME.includes(type.toLowerCase());
}

export function isAllowedType(type: string): boolean {
  const t = (type || '').toLowerCase();
  return IMAGE_MIME.includes(t) || DOC_MIME.includes(t);
}

/** Decoded byte length of a base64 data URL, without allocating the buffer. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

export function sumBytes(attachments: Attachment[]): number {
  return attachments.reduce((n, a) => n + a.size, 0);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export type CapResult = { ok: true } | { ok: false; reason: string };

/** Pure cap gate: honors the 10MB/file and 20MB/turn limits with a graceful,
 *  human message instead of crashing on an oversized upload. */
export function checkCap(existing: Attachment[], incomingBytes: number, incomingName = 'That file'): CapResult {
  if (incomingBytes > MAX_FILE_BYTES) {
    return { ok: false, reason: `${incomingName} is ${formatBytes(incomingBytes)} — over the ${formatBytes(MAX_FILE_BYTES)} per-file limit. Try a smaller file.` };
  }
  const total = sumBytes(existing) + incomingBytes;
  if (total > MAX_TURN_BYTES) {
    return { ok: false, reason: `Adding ${incomingName} would exceed the ${formatBytes(MAX_TURN_BYTES)} per-message limit. Send what you have, then attach the rest.` };
  }
  return { ok: true };
}

/** Downscale math for large images — keeps aspect ratio, caps the long edge.
 *  Returns integer dimensions; returns the input unchanged when already small. */
export function downscaleDimensions(w: number, h: number, maxDim = IMAGE_MAX_DIM): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const longEdge = Math.max(w, h);
  if (longEdge <= maxDim) return { w: Math.round(w), h: Math.round(h) };
  const scale = maxDim / longEdge;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

// ── Barcode / UPC ──────────────────────────────────────────────────────────

/** Keep only digits — scanners and manual entry both feed here. */
export function normalizeUpc(raw: string): string {
  return (raw || '').replace(/\D+/g, '');
}

/** UPC-A/EAN-13/EAN-8/GTIN-14 mod-10 check-digit validation (pure). */
export function isValidUpc(code: string): boolean {
  const d = normalizeUpc(code);
  if (![8, 12, 13, 14].includes(d.length)) return false;
  const digits = d.split('').map(Number);
  const check = digits.pop() as number;
  // From the rightmost non-check digit, weights alternate 3,1,3,1…
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += digits[i] * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** Catalog lookup outcome — the model/backend never invents a product. Every
 *  branch maps to exactly one honest UI state; a hit requires a real `item`. */
export type CatalogState = 'not-connected' | 'catalog-unreachable' | 'not-found' | 'found';

export interface CatalogItem {
  upc: string;
  name: string;
  price?: number | null;
  stock?: number | null;
  store?: string | null;
}

export interface CatalogLookupInput {
  /** Is any POS/store connected to this workspace? */
  connected: boolean;
  /** Did the catalog read complete without a transport/permission error? */
  reachable: boolean;
  /** The matched item, if the catalog returned exactly one. */
  item?: CatalogItem | null;
}

/** Pure resolver for the three-plus honest barcode states. Order matters:
 *  a missing store connection is reported before an unreachable catalog, and a
 *  reachable-but-empty read is "not found" — never a fabricated match. */
export function resolveCatalogState(input: CatalogLookupInput): CatalogState {
  if (!input.connected) return 'not-connected';
  if (!input.reachable) return 'catalog-unreachable';
  if (input.item && input.item.name) return 'found';
  return 'not-found';
}

/** The chat query a scanned UPC becomes when a store IS connected. The explicit
 *  "do not guess" instruction threads the never-fabricate rule to the model, so
 *  an item the catalog doesn't have comes back as an honest not-found. */
export function barcodeLookupQuery(upc: string): string {
  return `Look up UPC ${normalizeUpc(upc)} in my connected store catalog and report the item name, price, and stock on hand. If this UPC is not in the catalog, say it is not found — do not guess or invent a product.`;
}

export const CATALOG_STATE_COPY: Record<Exclude<CatalogState, 'found'>, { title: string; body: string; cta: string }> = {
  'not-connected': { title: 'No store connected', body: 'Link a POS store to look up scanned items in your live catalog.', cta: 'Connect Store' },
  'catalog-unreachable': { title: 'Catalog unavailable', body: 'The connected store’s catalog could not be reached just now. Try again in a moment.', cta: 'Retry' },
  'not-found': { title: 'Not in your catalog', body: 'That barcode did not match any item in your connected store. Want to add it?', cta: 'Add item' },
};
