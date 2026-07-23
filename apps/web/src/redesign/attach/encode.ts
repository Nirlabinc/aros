// Imperative shell for attachment encoding: File -> base64 data URL, with
// client-side downscaling for large images. Pure math + caps live in
// attachments.ts; this module owns the browser I/O (FileReader, canvas, Image).

import { Attachment, dataUrlBytes, downscaleDimensions, isHeic, isImage, resolveType } from './attachments';

/** An encode failure the composer can explain to the user verbatim. */
export class EncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncodeError';
  }
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through to the counter */ }
  return `att-${Date.now()}-${idSeq}`;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error ?? new Error('Could not read the file.'));
    fr.onload = () => resolve(String(fr.result));
    fr.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the image.'));
    img.src = dataUrl;
  });
}

/** Re-encode an image data URL as JPEG at (optionally) reduced dimensions.
 *  Returns null when the browser cannot decode the source at all — which is
 *  exactly what happens for HEIC outside Safari. */
async function toJpeg(dataUrl: string, maxDim?: number): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const img = await loadImage(dataUrl);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) return null;
    const { w, h } = downscaleDimensions(srcW, srcH, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), w, h };
  } catch {
    return null;
  }
}

/**
 * Normalise an encoded pick into something the wire actually accepts.
 *  - HEIC/HEIF is ALWAYS transcoded to JPEG. The router forwards `media_type`
 *    verbatim and Anthropic rejects HEIC, so shipping it means a hard 400 the
 *    user cannot act on. If the browser can't decode HEIC (everything except
 *    Safari), we fail loudly with a recoverable instruction.
 *  - Other large images are downscaled to IMAGE_MAX_DIM and re-encoded as JPEG
 *    when that is genuinely smaller.
 */
async function normalizeImage(dataUrl: string, type: string, name: string): Promise<{ dataUrl: string; type: string; name: string }> {
  if (!isImage(type)) return { dataUrl, type, name };

  if (isHeic(type)) {
    const jpeg = await toJpeg(dataUrl);
    if (!jpeg) {
      throw new EncodeError(
        `${name || 'That photo'} is a HEIC image this browser can’t convert. On iPhone: Settings → Camera → Formats → “Most Compatible”, or take a screenshot and attach that.`,
      );
    }
    return { dataUrl: jpeg.dataUrl, type: 'image/jpeg', name: name.replace(/\.(heic|heif)$/i, '.jpg') };
  }

  // Animated GIFs lose their frames through a canvas — leave them alone.
  if (type === 'image/gif') return { dataUrl, type, name };

  // Only re-encode when the image genuinely needs shrinking: a lossy pass over
  // an already-small screenshot costs the small print the model has to read.
  let img: HTMLImageElement;
  try {
    img = await loadImage(dataUrl);
  } catch {
    return { dataUrl, type, name };
  }
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const target = downscaleDimensions(srcW, srcH);
  if (!srcW || !srcH || (target.w === srcW && target.h === srcH)) return { dataUrl, type, name };

  const jpeg = await toJpeg(dataUrl);
  if (!jpeg || jpeg.dataUrl.length >= dataUrl.length) return { dataUrl, type, name };
  return { dataUrl: jpeg.dataUrl, type: 'image/jpeg', name };
}

/** Encode a picked File/Blob into a wire-ready Attachment (downscaling images,
 *  transcoding HEIC). Throws EncodeError with user-facing copy on failure. */
export async function encodeAttachment(file: File | Blob, fallbackName = 'attachment'): Promise<Attachment> {
  const rawName = (file as File).name || `${fallbackName}-${Date.now()}`;
  const rawType = resolveType(rawName, (file as File).type || '');
  const raw = await readAsDataUrl(file);
  const { dataUrl, type, name } = await normalizeImage(raw, rawType, rawName);
  return { id: nextId(), name, type, dataUrl, size: dataUrlBytes(dataUrl) };
}
