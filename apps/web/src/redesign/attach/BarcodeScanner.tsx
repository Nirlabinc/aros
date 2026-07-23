import { useEffect, useRef, useState } from 'react';
import { isValidUpc, normalizeUpc } from './attachments';
import { buildFrameDecoder, decodeWithZxing, Decoder } from './decode';

/**
 * Barcode scanner sheet. Live camera scan (BarcodeDetector or zxing-wasm),
 * a still "take a photo" path for browsers without a live loop, and an
 * always-present manual UPC entry floor. Camera-denied degrades to manual +
 * photo — never a dead/black pane. Emits the decoded/typed UPC via onDetected.
 */
export function BarcodeScanner({ open, onClose, onDetected }: { open: boolean; onClose: () => void; onDetected: (upc: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decoderRef = useRef<Decoder | null>(null);
  const rafRef = useRef<number | null>(null);
  const [mode, setMode] = useState<'starting' | 'scanning' | 'denied' | 'no-camera'>('starting');
  const [manual, setManual] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMode('starting');
    setManual('');
    setNote('');

    (async () => {
      decoderRef.current = await buildFrameDecoder();
      if (cancelled) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        setMode('no-camera');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        setMode('scanning');
        setNote(decoderRef.current ? 'Point the camera at a barcode.' : 'Live scanning is unavailable on this browser — take a photo or type the code.');
        loop();
      } catch (err) {
        const name = (err as { name?: string })?.name;
        setMode(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'no-camera');
      }
    })();

    function loop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const decode = decoderRef.current;
      if (cancelled || !video || !canvas || !decode || video.readyState < 2) {
        if (!cancelled) rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const w = video.videoWidth, h = video.videoHeight;
      if (w && h) {
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          void decode(canvas).then((code) => {
            if (cancelled || !code) return;
            if (isValidUpc(code)) { finish(code); }
          });
        }
      }
      // Throttle the decode loop to ~4 fps.
      rafRef.current = window.setTimeout(() => { rafRef.current = requestAnimationFrame(loop); }, 250) as unknown as number;
    }

    function finish(code: string) {
      stop();
      onDetected(code);
    }

    return () => { cancelled = true; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function stop() {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); clearTimeout(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNote('Reading photo…');
    const code = await decodeWithZxing(file);
    if (code && isValidUpc(code)) { stop(); onDetected(code); return; }
    setNote(code ? 'That code did not look like a valid UPC. Try again or type it below.' : 'No barcode found in that photo. Try again or type the code below.');
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeUpc(manual);
    if (!code) return;
    if (!isValidUpc(code)) { setNote('That is not a valid 8/12/13/14-digit UPC/EAN. Check the digits and try again.'); return; }
    stop();
    onDetected(code);
  }

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Scan a barcode" onClick={onClose} style={S.overlay}>
      <div onClick={(e) => e.stopPropagation()} style={S.sheet}>
        <div style={S.header}>
          <span style={S.title}>Scan a barcode</span>
          <button type="button" aria-label="Close scanner" onClick={onClose} style={S.close}>✕</button>
        </div>

        <div style={S.stage}>
          {mode === 'scanning' ? (
            <>
              <video ref={videoRef} playsInline muted style={S.video} />
              <div style={S.reticle} aria-hidden />
            </>
          ) : (
            <div style={S.placeholder}>
              {mode === 'starting' && <span>Starting camera…</span>}
              {mode === 'denied' && <span>Camera access is blocked. Take a photo or type the code below — no camera needed.</span>}
              {mode === 'no-camera' && <span>No camera available here. Take a photo or type the code below.</span>}
            </div>
          )}
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {note && <div style={S.note}>{note}</div>}

        <label style={S.photoBtn}>
          Take / choose a photo
          <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} />
        </label>

        <form onSubmit={submitManual} style={S.manualRow}>
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            inputMode="numeric"
            placeholder="Enter UPC / barcode number"
            aria-label="Enter barcode number manually"
            style={S.manualInput}
          />
          <button type="submit" disabled={!normalizeUpc(manual)} style={{ ...S.manualSend, opacity: normalizeUpc(manual) ? 1 : 0.5 }}>Look up</button>
        </form>
        <div style={S.hint}>Manual entry always works, even without a camera.</div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  sheet: { width: 'min(440px, 100vw)', background: '#fff', color: '#1a1a2e', borderRadius: '16px 16px 0 0', padding: 16, boxShadow: '0 -8px 40px rgba(0,0,0,0.3)', fontFamily: 'Inter, system-ui, sans-serif', maxHeight: '92vh', overflowY: 'auto' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 15, fontWeight: 700 },
  close: { width: 30, height: 30, borderRadius: 8, border: 'none', background: '#f1f1f4', cursor: 'pointer', fontSize: 14 },
  stage: { position: 'relative', width: '100%', aspectRatio: '4 / 3', background: '#111', borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  video: { width: '100%', height: '100%', objectFit: 'cover' },
  reticle: { position: 'absolute', left: '12%', right: '12%', top: '40%', height: '20%', border: '2px solid rgba(255,255,255,0.9)', borderRadius: 10, boxShadow: '0 0 0 100vh rgba(0,0,0,0.15)' },
  placeholder: { color: '#e5e7eb', fontSize: 13, textAlign: 'center', padding: 24, lineHeight: 1.5 },
  note: { marginTop: 10, fontSize: 12.5, color: '#6b5b2e', background: '#fbf6e8', border: '1px solid #efe2bd', borderRadius: 8, padding: '8px 10px' },
  photoBtn: { display: 'block', textAlign: 'center', marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#f5f6fb', color: '#3b5bdb', border: '1px solid #d6def9', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  manualRow: { display: 'flex', gap: 8, marginTop: 12 },
  manualInput: { flex: 1, minWidth: 0, padding: '10px 12px', fontSize: 14, borderRadius: 10, border: '1px solid #d1d5db', outline: 'none' },
  manualSend: { padding: '0 16px', borderRadius: 10, border: 'none', background: '#3b5bdb', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  hint: { marginTop: 8, fontSize: 11.5, color: '#9ca3af', textAlign: 'center' },
};
