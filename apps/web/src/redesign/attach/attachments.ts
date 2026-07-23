// Functional core for rich chat attachments (photo · file · camera · barcode).
// Pure, framework-free, DOM-free — unit-tested with plain asserts. The React
// components and browser APIs (FileReader, canvas, camera, BarcodeDetector)
// live in the imperative shell (encode.ts, AttachSheet.tsx, BarcodeScanner.tsx).

// ── Transport ceiling ──────────────────────────────────────────────────────
// The client cap is NOT a product choice — it is whatever the wire can actually
// carry. Every AROS chat turn crosses an nginx that sets
// `client_max_body_size 10m` (shreai/config/nginx-prod.conf:43 and
// deploy/hostinger/nginx.conf:149), so a body above that is rejected at the
// edge with a 413 before any of our code runs. Attachments ride as base64 data
// URLs inside the JSON body, which inflates them by 4/3. Advertising a "20 MB
// per message" limit while the transport dies at 10 MB of *encoded* bytes is
// exactly the kind of promise the journey forbids — so the caps below are
// derived from the ceiling and the copy quotes the derived number.

/** Hard edge limit on the whole HTTP request body (nginx `client_max_body_size`). */
export const TRANSPORT_MAX_BODY_BYTES = 10 * 1024 * 1024;
/** Room reserved for the JSON envelope: system prompt, transcript, metadata. */
export const ENVELOPE_RESERVE_BYTES = 256 * 1024;

/** Encoded size of `decodedBytes` once base64'd into a data URL (4/3 + prefix). */
export function base64WireBytes(decodedBytes: number): number {
  if (decodedBytes <= 0) return 0;
  return Math.ceil(decodedBytes / 3) * 4 + 64;
}

/** Largest decoded payload whose base64 form still fits under the edge limit. */
export function maxDecodedBytesForTransport(
  transport = TRANSPORT_MAX_BODY_BYTES,
  reserve = ENVELOPE_RESERVE_BYTES,
): number {
  return Math.max(0, Math.floor(((transport - reserve - 64) / 4) * 3));
}

/** Per-turn cap: 7 MB decoded ≈ 9.34 MB on the wire, inside the 10 MB edge. */
export const MAX_TURN_BYTES = 7 * 1024 * 1024;
/** Per-file cap: a single file may not fill the whole turn budget. */
export const MAX_FILE_BYTES = 6 * 1024 * 1024;
/** Count cap — matches the router's own per-turn attachment limit. */
export const MAX_ATTACHMENTS = 50;
/** Large images are downscaled client-side before base64 encoding. */
export const IMAGE_MAX_DIM = 2000;

/** MIME allowlist — images the vision model reads, plus documents the router
 *  text-extracts. Anything else is rejected before encode.
 *
 *  Deliberately EXCLUDED:
 *  - legacy binary Office (`.doc`/`.xls`/`.ppt`): the router has no OLE2 parser,
 *    so they fall through to a UTF-8 decode of binary and reach the model as
 *    mojibake labelled "[Content of x]" — a fabrication vector.
 *  - HEIC/HEIF as a *wire* type: Anthropic rejects it and the router forwards
 *    media_type verbatim. HEIC picks are accepted at the input and transcoded to
 *    JPEG in encode.ts (see HEIC_MIME); if the browser can't transcode, the user
 *    gets an honest, actionable message instead of a silent 400. */
export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const HEIC_MIME = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
export const DOC_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
];
/** Extension → MIME fallback. Android/Windows hand back files with an EMPTY
 *  `file.type` often enough that a type-only allowlist rejects perfectly good
 *  PDFs and photos; the extension is then the only signal we have. */
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', md: 'text/plain', csv: 'text/csv',
};

const EXT_ACCEPT = Object.keys(EXT_MIME).map((e) => `.${e}`);

/** `accept` for the generic "File" picker — images AND documents. */
export const ATTACH_ACCEPT = [...IMAGE_MIME, ...HEIC_MIME, ...DOC_MIME, ...EXT_ACCEPT].join(',');
/** `accept` for the image-only pickers (Photo / Camera). */
export const IMAGE_ACCEPT = [...IMAGE_MIME, ...HEIC_MIME, '.heic', '.heif'].join(',');

export function extensionOf(name: string): string {
  const dot = (name || '').lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Resolve the effective MIME for a pick: the browser's type when we trust it,
 *  otherwise the extension. Returns '' when neither is recognised. */
export function resolveType(name: string, type: string): string {
  const t = (type || '').toLowerCase().split(';')[0].trim();
  if (isAllowedType(t)) return t;
  return EXT_MIME[extensionOf(name)] || '';
}

/** One attachment as sent to the router: { name, type, dataUrl }. `size` is the
 *  decoded byte count and `id` a client-local handle — neither goes on the wire. */
export interface Attachment {
  id: string;
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
  const t = (type || '').toLowerCase();
  return IMAGE_MIME.includes(t) || HEIC_MIME.includes(t);
}

export function isHeic(type: string): boolean {
  return HEIC_MIME.includes((type || '').toLowerCase());
}

/** Types we accept at the INPUT (HEIC included — encode.ts transcodes it). */
export function isAllowedType(type: string): boolean {
  const t = (type || '').toLowerCase();
  return IMAGE_MIME.includes(t) || HEIC_MIME.includes(t) || DOC_MIME.includes(t);
}

/** Types allowed on the WIRE (HEIC excluded — Anthropic rejects it). */
export function isWireType(type: string): boolean {
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

/** Pure cap gate: file size, turn size, and file count. The messages quote the
 *  caps we can actually honour end-to-end (see TRANSPORT_MAX_BODY_BYTES) — an
 *  advertised limit the transport rejects is a broken promise, not a limit. */
export function checkCap(existing: Attachment[], incomingBytes: number, incomingName = 'That file'): CapResult {
  if (existing.length >= MAX_ATTACHMENTS) {
    return { ok: false, reason: `You can attach up to ${MAX_ATTACHMENTS} files in one message. Send these, then attach the rest.` };
  }
  if (incomingBytes > MAX_FILE_BYTES) {
    return { ok: false, reason: `${incomingName} is ${formatBytes(incomingBytes)} — over the ${formatBytes(MAX_FILE_BYTES)} per-file limit. Try a smaller file, or photograph the page you need.` };
  }
  const total = sumBytes(existing) + incomingBytes;
  if (total > MAX_TURN_BYTES) {
    return { ok: false, reason: `Adding ${incomingName} would push this message over the ${formatBytes(MAX_TURN_BYTES)} limit. Send what you have, then attach the rest.` };
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

/** Phrases a truthful "I don't have it" answer uses. Matching only ever DOWN-
 *  grades a claim (found → not-found) and adds the "Add item" CTA beside the
 *  model's own words, so a false positive can never invent a product. */
const NOT_FOUND_PHRASES =
  /\b(not\s+(?:be\s+)?(?:found|in|listed|available)|no\s+(?:match|item|product|result)|isn'?t\s+in|couldn'?t\s+find|could\s+not\s+find|does\s+not\s+(?:appear|exist)|doesn'?t\s+(?:appear|exist)|unable\s+to\s+(?:find|locate))\b/i;

export function readsAsNotFound(reply: string): boolean {
  // Models emit curly apostrophes ("couldn’t"); normalise before matching or
  // half the honest not-found answers slip through as "found".
  return NOT_FOUND_PHRASES.test((reply || '').replace(/[‘’ʼ]/g, "'"));
}

/** Production resolver for a barcode turn: maps the three things we actually
 *  know — is a store connected, did the turn complete, what did it say — onto
 *  the four honest catalog states. This is what wires CATALOG_STATE_COPY to UI. */
export function barcodeOutcome(input: { connected: boolean; transportOk: boolean; replyText?: string | null }): CatalogState {
  const reply = (input.replyText || '').trim();
  return resolveCatalogState({
    connected: input.connected,
    reachable: input.transportOk,
    item: reply && !readsAsNotFound(reply) ? { upc: '', name: reply } : null,
  });
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

// ── Composer errors ────────────────────────────────────────────────────────

export interface AttachError { id: string; text: string }

let errorSeq = 0;
export function attachError(text: string): AttachError {
  errorSeq += 1;
  return { id: `ae-${errorSeq}`, text };
}
