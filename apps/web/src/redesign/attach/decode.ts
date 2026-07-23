// Imperative shell for barcode decoding. Two engines, one contract:
//   1. Native BarcodeDetector  — Chrome / Android / newer Safari (fast, no JS).
//   2. zxing-wasm (bundled)     — iPad Safari / Firefox, which lack (1).
// Both feed the same normalize/validate core (attachments.ts). A manual UPC
// field in BarcodeScanner is the always-present floor if neither engine loads.

import { normalizeUpc } from './attachments';

/** Retail 1D symbologies we care about for UPC/EAN price-tag scanning. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'];

export function hasBarcodeDetector(): boolean {
  return typeof (globalThis as any).BarcodeDetector === 'function';
}

export async function createNativeDetector(): Promise<any | null> {
  try {
    const BD = (globalThis as any).BarcodeDetector;
    if (typeof BD !== 'function') return null;
    // Only request formats the browser actually supports.
    let formats = FORMATS;
    if (typeof BD.getSupportedFormats === 'function') {
      const supported: string[] = await BD.getSupportedFormats();
      formats = FORMATS.filter((f) => supported.includes(f));
      if (formats.length === 0) return null;
    }
    return new BD({ formats });
  } catch {
    return null;
  }
}

/** Decode from any canvas-drawable source using the native detector. */
export async function detectNative(detector: any, source: CanvasImageSource | ImageBitmap): Promise<string | null> {
  try {
    const codes = await detector.detect(source);
    const raw = codes?.[0]?.rawValue;
    return raw ? normalizeUpc(String(raw)) : null;
  } catch {
    return null;
  }
}

let zxingReady: Promise<typeof import('zxing-wasm/reader')> | null = null;

/** Lazy-load zxing-wasm once, pointing it at the Vite-bundled .wasm asset so no
 *  network fetch is required (works offline / behind strict CSP). Returns null
 *  if the module or wasm can't load — the caller degrades to manual entry. */
async function loadZxing(): Promise<typeof import('zxing-wasm/reader') | null> {
  if (!zxingReady) {
    zxingReady = (async () => {
      const mod = await import('zxing-wasm/reader');
      try {
        const { default: wasmUrl } = await import('zxing-wasm/reader/zxing_reader.wasm?url');
        mod.setZXingModuleOverrides({ locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? (wasmUrl as string) : prefix + path) });
      } catch {
        /* fall back to the module's default wasm resolution */
      }
      return mod;
    })();
  }
  try {
    return await zxingReady;
  } catch {
    zxingReady = null;
    return null;
  }
}

/** Decode a still image (Blob/File or ImageData) via zxing-wasm. */
export async function decodeWithZxing(source: Blob | ImageData): Promise<string | null> {
  const mod = await loadZxing();
  if (!mod) return null;
  try {
    const results = await mod.readBarcodes(source, { tryHarder: true } as any);
    const raw = results?.find((r: any) => r?.text)?.text;
    return raw ? normalizeUpc(String(raw)) : null;
  } catch {
    return null;
  }
}

export type Decoder = (canvas: HTMLCanvasElement) => Promise<string | null>;

/** Build the best available frame decoder for a live <video> scan loop, or null
 *  if no engine is usable (caller shows manual entry only). */
export async function buildFrameDecoder(): Promise<Decoder | null> {
  const detector = await createNativeDetector();
  if (detector) return (canvas) => detectNative(detector, canvas);
  const mod = await loadZxing();
  if (mod) {
    return async (canvas) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return decodeWithZxing(data);
    };
  }
  return null;
}
