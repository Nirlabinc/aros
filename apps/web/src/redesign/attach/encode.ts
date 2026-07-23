// Imperative shell for attachment encoding: File -> base64 data URL, with
// client-side downscaling for large images. Pure math + caps live in
// attachments.ts; this module owns the browser I/O (FileReader, canvas, Image).

import { Attachment, dataUrlBytes, downscaleDimensions, isImage } from './attachments';

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

/** Downscale a large image to keep the long edge <= IMAGE_MAX_DIM and re-encode
 *  as JPEG (quality 0.85). Falls back to the original data URL if the canvas
 *  path is unavailable or the source is not an image. */
async function maybeDownscale(dataUrl: string, type: string): Promise<{ dataUrl: string; type: string }> {
  if (!isImage(type) || type === 'image/gif') return { dataUrl, type };
  try {
    const img = await loadImage(dataUrl);
    const { w, h } = downscaleDimensions(img.naturalWidth || img.width, img.naturalHeight || img.height);
    if (w === (img.naturalWidth || img.width) && h === (img.naturalHeight || img.height)) return { dataUrl, type };
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { dataUrl, type };
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/jpeg', 0.85);
    return out.length < dataUrl.length ? { dataUrl: out, type: 'image/jpeg' } : { dataUrl, type };
  } catch {
    return { dataUrl, type };
  }
}

/** Encode a picked File/Blob into a wire-ready Attachment (downscaling images). */
export async function encodeAttachment(file: File | Blob, fallbackName = 'attachment'): Promise<Attachment> {
  const rawType = (file as File).type || 'application/octet-stream';
  const name = (file as File).name || `${fallbackName}-${Date.now()}`;
  const raw = await readAsDataUrl(file);
  const { dataUrl, type } = await maybeDownscale(raw, rawType);
  return { name, type, dataUrl, size: dataUrlBytes(dataUrl) };
}
