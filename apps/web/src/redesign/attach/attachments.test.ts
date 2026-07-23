import { describe, it, expect } from 'vitest';
import {
  Attachment,
  ATTACH_ACCEPT,
  ENVELOPE_RESERVE_BYTES,
  IMAGE_ACCEPT,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MAX_TURN_BYTES,
  TRANSPORT_MAX_BODY_BYTES,
  barcodeLookupQuery,
  barcodeOutcome,
  base64WireBytes,
  checkCap,
  dataUrlBytes,
  downscaleDimensions,
  isAllowedType,
  isHeic,
  isImage,
  isValidUpc,
  isWireType,
  maxDecodedBytesForTransport,
  normalizeUpc,
  readsAsNotFound,
  resolveCatalogState,
  resolveType,
  toWire,
} from './attachments';

const att = (size: number, name = 'x', type = 'image/png'): Attachment => ({ id: `id-${name}-${size}`, name, type, dataUrl: 'data:,', size });

describe('mime allowlist', () => {
  it('accepts images and modern documents, rejects the rest', () => {
    expect(isAllowedType('image/jpeg')).toBe(true);
    expect(isAllowedType('application/pdf')).toBe(true);
    expect(isImage('image/png')).toBe(true);
    expect(isImage('application/pdf')).toBe(false);
    expect(isAllowedType('application/x-msdownload')).toBe(false);
    expect(isAllowedType('')).toBe(false);
  });

  it('rejects legacy binary Office — the router would feed the model mojibake', () => {
    // .doc / .xls / .ppt have no parser upstream; they fall through to a UTF-8
    // decode of OLE2 binary and reach the model as "[Content of x]" garbage,
    // which it then confidently summarises. That is a fabrication vector.
    expect(isAllowedType('application/msword')).toBe(false);
    expect(isAllowedType('application/vnd.ms-excel')).toBe(false);
    expect(isAllowedType('application/vnd.ms-powerpoint')).toBe(false);
    expect(isAllowedType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
  });

  it('accepts HEIC at the input but never on the wire', () => {
    expect(isAllowedType('image/heic')).toBe(true);
    expect(isHeic('image/heif')).toBe(true);
    // Anthropic rejects HEIC and the router forwards media_type verbatim, so
    // encode.ts must transcode it to JPEG before it is sent.
    expect(isWireType('image/heic')).toBe(false);
    expect(isWireType('image/jpeg')).toBe(true);
  });

  it('offers images in the generic File picker', () => {
    // `DOC_ACCEPT || ATTACH_ACCEPT` never fell through, so "File" could not
    // pick a screenshot.
    expect(ATTACH_ACCEPT).toMatch(/image\/png/);
    expect(ATTACH_ACCEPT).toMatch(/application\/pdf/);
    expect(IMAGE_ACCEPT).not.toMatch(/application\/pdf/);
  });
});

describe('resolveType — empty file.type fallback', () => {
  it('trusts a recognised browser type', () => {
    expect(resolveType('scan.pdf', 'application/pdf')).toBe('application/pdf');
    expect(resolveType('a.png', 'image/png; charset=binary')).toBe('image/png');
  });
  it('falls back to the extension when the browser gives nothing', () => {
    // Android/Windows regularly hand back an empty type — rejecting on that
    // alone refused perfectly good PDFs and photos.
    expect(resolveType('invoice.pdf', '')).toBe('application/pdf');
    expect(resolveType('IMG_0042.HEIC', '')).toBe('image/heic');
    expect(resolveType('sheet.xlsx', '')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
  it('still rejects what neither signal recognises', () => {
    expect(resolveType('payload.exe', '')).toBe('');
    expect(resolveType('noext', 'application/x-msdownload')).toBe('');
  });
});

describe('dataUrlBytes', () => {
  it('estimates decoded size from base64 length', () => {
    // "hi" -> "aGk=" (4 chars, 1 pad) -> 2 bytes
    expect(dataUrlBytes('data:text/plain;base64,aGk=')).toBe(2);
    expect(dataUrlBytes('not-a-data-url')).toBe(0);
  });
});

describe('transport-derived caps', () => {
  it('base64 inflates by 4/3', () => {
    expect(base64WireBytes(3)).toBe(4 + 64);
    expect(base64WireBytes(0)).toBe(0);
  });

  it('a full turn still fits under the nginx client_max_body_size', () => {
    // This is the whole point of the caps. The composer used to advertise
    // 20 MB per message while every turn crossed an nginx capped at 10 MB —
    // a promise the transport rejects with a 413 is not a limit, it is a lie.
    expect(base64WireBytes(MAX_TURN_BYTES) + ENVELOPE_RESERVE_BYTES).toBeLessThan(TRANSPORT_MAX_BODY_BYTES);
    expect(MAX_TURN_BYTES).toBeLessThanOrEqual(maxDecodedBytesForTransport());
    expect(MAX_FILE_BYTES).toBeLessThanOrEqual(MAX_TURN_BYTES);
  });

  it('quotes the real limit in the user-facing message', () => {
    const r = checkCap([], MAX_FILE_BYTES + 1, 'big.png');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/big\.png/);
      expect(r.reason).toMatch(/6\.0 MB/);
      expect(r.reason).not.toMatch(/20\.0 MB/);
    }
  });
});

describe('checkCap', () => {
  it('passes an in-bounds file', () => {
    expect(checkCap([], 1000)).toEqual({ ok: true });
  });
  it('rejects when the turn cap would be exceeded', () => {
    const existing = [att(MAX_TURN_BYTES - 500)];
    const r = checkCap(existing, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/limit/);
  });
  it('rejects past the file-count cap', () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => att(10, `f${i}`));
    const r = checkCap(existing, 10, 'one-more.png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(new RegExp(String(MAX_ATTACHMENTS)));
  });
});

describe('downscaleDimensions', () => {
  it('leaves small images unchanged', () => {
    expect(downscaleDimensions(800, 600)).toEqual({ w: 800, h: 600 });
  });
  it('caps the long edge and keeps aspect ratio', () => {
    const { w, h } = downscaleDimensions(4000, 2000, 2000);
    expect(w).toBe(2000);
    expect(h).toBe(1000);
  });
  it('handles degenerate input', () => {
    expect(downscaleDimensions(0, 0)).toEqual({ w: 0, h: 0 });
  });
});

describe('UPC validation', () => {
  it('normalizes to digits', () => {
    expect(normalizeUpc(' 0-12345 678905 ')).toBe('012345678905');
  });
  it('accepts valid UPC-A / EAN-13 / EAN-8', () => {
    expect(isValidUpc('036000291452')).toBe(true); // UPC-A
    expect(isValidUpc('4006381333931')).toBe(true); // EAN-13
    expect(isValidUpc('73513537')).toBe(true); // EAN-8
  });
  it('rejects wrong check digit and bad lengths', () => {
    expect(isValidUpc('036000291453')).toBe(false);
    expect(isValidUpc('12345')).toBe(false);
    expect(isValidUpc('')).toBe(false);
  });
});

describe('resolveCatalogState — never fabricates', () => {
  it('reports not-connected before anything else', () => {
    expect(resolveCatalogState({ connected: false, reachable: true, item: { upc: '1', name: 'X' } })).toBe('not-connected');
  });
  it('reports catalog-unreachable on transport failure', () => {
    expect(resolveCatalogState({ connected: true, reachable: false })).toBe('catalog-unreachable');
  });
  it('reports not-found for a reachable-but-empty read', () => {
    expect(resolveCatalogState({ connected: true, reachable: true, item: null })).toBe('not-found');
  });
  it('reports found only with a real named item', () => {
    expect(resolveCatalogState({ connected: true, reachable: true, item: { upc: '036000291452', name: 'Fireball 750ml' } })).toBe('found');
  });
});

describe('barcodeOutcome — the production resolver', () => {
  it('never sends a scan anywhere without a connected store', () => {
    expect(barcodeOutcome({ connected: false, transportOk: true, replyText: 'Fireball 750ml, $18.99' })).toBe('not-connected');
  });
  it('maps a failed turn to catalog-unreachable', () => {
    expect(barcodeOutcome({ connected: true, transportOk: false })).toBe('catalog-unreachable');
  });
  it('honours the model saying it does not have the item', () => {
    expect(readsAsNotFound('That UPC is not found in your catalog.')).toBe(true);
    expect(readsAsNotFound('I couldn’t find that item.')).toBe(true);
    expect(barcodeOutcome({ connected: true, transportOk: true, replyText: 'That UPC is not in your catalog.' })).toBe('not-found');
  });
  it('treats an empty reply as not-found, never found', () => {
    expect(barcodeOutcome({ connected: true, transportOk: true, replyText: '' })).toBe('not-found');
    expect(barcodeOutcome({ connected: true, transportOk: true, replyText: null })).toBe('not-found');
  });
  it('reports found for a real grounded answer', () => {
    expect(barcodeOutcome({ connected: true, transportOk: true, replyText: 'Fireball 750ml — $18.99, 14 on hand.' })).toBe('found');
  });
});

describe('barcodeLookupQuery', () => {
  it('embeds the normalized UPC and a do-not-guess instruction', () => {
    const q = barcodeLookupQuery(' 0360-00291452 ');
    expect(q).toMatch(/036000291452/);
    expect(q.toLowerCase()).toMatch(/do not guess|not found/);
  });
});

describe('toWire', () => {
  it('drops the local-only id and size fields', () => {
    expect(toWire(att(1234, 'r.png', 'image/png'))).toEqual({ name: 'r.png', type: 'image/png', dataUrl: 'data:,' });
  });
});
