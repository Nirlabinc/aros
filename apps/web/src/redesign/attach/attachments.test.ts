import { describe, it, expect } from 'vitest';
import {
  Attachment,
  MAX_FILE_BYTES,
  MAX_TURN_BYTES,
  checkCap,
  dataUrlBytes,
  downscaleDimensions,
  isAllowedType,
  isImage,
  isValidUpc,
  normalizeUpc,
  resolveCatalogState,
  barcodeLookupQuery,
  toWire,
} from './attachments';

const att = (size: number, name = 'x', type = 'image/png'): Attachment => ({ name, type, dataUrl: 'data:,', size });

describe('mime allowlist', () => {
  it('accepts images and documents, rejects the rest', () => {
    expect(isAllowedType('image/jpeg')).toBe(true);
    expect(isAllowedType('application/pdf')).toBe(true);
    expect(isImage('image/png')).toBe(true);
    expect(isImage('application/pdf')).toBe(false);
    expect(isAllowedType('application/x-msdownload')).toBe(false);
    expect(isAllowedType('')).toBe(false);
  });
});

describe('dataUrlBytes', () => {
  it('estimates decoded size from base64 length', () => {
    // "hi" -> "aGk=" (4 chars, 1 pad) -> 2 bytes
    expect(dataUrlBytes('data:text/plain;base64,aGk=')).toBe(2);
    expect(dataUrlBytes('not-a-data-url')).toBe(0);
  });
});

describe('checkCap', () => {
  it('passes an in-bounds file', () => {
    expect(checkCap([], 1000)).toEqual({ ok: true });
  });
  it('rejects an over-10MB file gracefully', () => {
    const r = checkCap([], MAX_FILE_BYTES + 1, 'big.png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/big\.png/);
  });
  it('rejects when the 20MB turn cap would be exceeded', () => {
    const existing = [att(MAX_TURN_BYTES - 500)];
    const r = checkCap(existing, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/per-message/);
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

describe('barcodeLookupQuery', () => {
  it('embeds the normalized UPC and a do-not-guess instruction', () => {
    const q = barcodeLookupQuery(' 0360-00291452 ');
    expect(q).toMatch(/036000291452/);
    expect(q.toLowerCase()).toMatch(/do not guess|not found/);
  });
});

describe('toWire', () => {
  it('drops the local-only size field', () => {
    expect(toWire(att(1234, 'r.png', 'image/png'))).toEqual({ name: 'r.png', type: 'image/png', dataUrl: 'data:,' });
  });
});
