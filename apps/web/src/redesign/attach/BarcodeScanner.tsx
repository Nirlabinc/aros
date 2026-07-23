import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidUpc, normalizeUpc } from './attachments';
import { buildFrameDecoder, decodeWithZxing, Decoder } from './decode';

/** Decode-loop period. Applied on EVERY branch — the "video not ready yet"
 *  path used to re-arm with requestAnimationFrame, which spun a 60 fps busy
 *  loop with the camera LED on for as long as the sheet stayed open. */
const DECODE_INTERVAL_MS = 250;

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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const [mode, setMode] = useState<'starting' | 'scanning' | 'denied' | 'no-camera'>('starting');
  const [attempt, setAttempt] = useState(0);
  const [manual, setManual] = useState('');
  const [note, setNote] = useState('');

  const stop = useCallback(() => {
    if (timerRef.current != null) { clearTimeout(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) { try { video.pause(); } catch { /* already stopped */ } video.srcObject = null; }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    doneRef.current = false;
    setMode('starting');
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
        // The <video> is mounted UNCONDITIONALLY (see render) precisely so it
        // exists at this moment. It used to be rendered only while
        // mode === 'scanning', so videoRef was null here, the stream was never
        // attached, and every scan showed a black pane with the camera on.
        const video = videoRef.current;
        if (!video) { stream.getTracks().forEach((t) => t.stop()); setMode('no-camera'); return; }
        video.srcObject = stream;
        setMode('scanning');
        await video.play().catch(() => { /* autoplay policy — the frame loop still reads it */ });
        setNote(decoderRef.current ? 'Point the camera at a barcode.' : 'Live scanning is unavailable on this browser — take a photo or type the code.');
        loop();
      } catch (err) {
        const name = (err as { name?: string })?.name;
        setMode(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'no-camera');
      }
    })();

    function loop() {
      if (cancelled || doneRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const decode = decoderRef.current;
      if (video && canvas && decode && video.readyState >= 2) {
        const w = video.videoWidth, h = video.videoHeight;
        if (w && h) {
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h);
            void decode(canvas).then((code) => {
              if (cancelled || !code) return;
              if (isValidUpc(code)) finish(code);
            });
          }
        }
      }
      // Re-arm on EVERY branch at the same throttle.
      timerRef.current = setTimeout(loop, DECODE_INTERVAL_MS);
    }

    function finish(code: string) {
      // A steady camera fires the same detection on consecutive frames; without
      // this guard the host receives two lookups for one scan.
      if (doneRef.current) return;
      doneRef.current = true;
      stop();
      onDetected(code);
    }

    return () => { cancelled = true; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt, stop]);

  // Focus in on open, restore on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement;
    const t = setTimeout(() => manualRef.current?.focus(), 60);
    return () => {
      clearTimeout(t);
      const prev = restoreFocusRef.current as HTMLElement | null;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    // Trap: aria-modal is a promise to the screen reader that the rest of the
    // page is inert — Tab must honour it.
    const nodes = sheetRef.current?.querySelectorAll<HTMLElement>('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])');
    const focusable = Array.from(nodes || []).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) { setNote('No photo came back. If the camera is blocked, allow it in your browser’s site settings — or type the number below.'); return; }
    setNote('Reading photo…');
    const code = await decodeWithZxing(file);
    if (code && isValidUpc(code) && !doneRef.current) { doneRef.current = true; stop(); onDetected(code); return; }
    setNote(code ? 'That code did not look like a valid UPC. Try again or type it below.' : 'No barcode found in that photo. Try again or type the code below.');
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeUpc(manual);
    if (!code) return;
    if (!isValidUpc(code)) { setNote('That is not a valid 8/12/13/14-digit UPC/EAN. Check the digits and try again.'); return; }
    if (doneRef.current) return;
    doneRef.current = true;
    stop();
    onDetected(code);
  }

  function retryCamera() {
    stop();
    setNote('');
    setManual('');
    setAttempt((n) => n + 1);
  }

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Scan a barcode" onClick={onClose} onKeyDown={onKeyDown} style={S.overlay}>
      <div ref={sheetRef} onClick={(e) => e.stopPropagation()} style={S.sheet}>
        <div style={S.header}>
          <span style={S.title}>Scan a barcode</span>
          <button type="button" aria-label="Close scanner" onClick={onClose} style={S.close}>✕</button>
        </div>

        <div style={S.stage}>
          {/* Always mounted. Hidden until a stream is attached, but present in
              the DOM so videoRef is non-null when getUserMedia resolves. */}
          <video ref={videoRef} playsInline muted style={{ ...S.video, display: mode === 'scanning' ? 'block' : 'none' }} />
          {mode === 'scanning' && <div style={S.reticle} aria-hidden />}
          {mode !== 'scanning' && (
            <div style={S.placeholder}>
              {mode === 'starting' && <span>Starting camera…</span>}
              {mode === 'denied' && <span>Camera access is blocked. Allow it in your browser’s site settings and try again — or take a photo / type the code below. No camera needed.</span>}
              {mode === 'no-camera' && <span>No camera available here. Take a photo or type the code below.</span>}
            </div>
          )}
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {note && <div role="status" aria-live="polite" style={S.note}>{note}</div>}

        {(mode === 'denied' || mode === 'no-camera') && (
          <button type="button" onClick={retryCamera} style={S.retryBtn}>Try camera again</button>
        )}

        <label style={S.photoBtn}>
          Take / choose a photo
          <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} />
        </label>

        <form onSubmit={submitManual} style={S.manualRow}>
          <input
            ref={manualRef}
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
  close: { width: 44, height: 44, borderRadius: 10, border: 'none', background: '#f1f1f4', cursor: 'pointer', fontSize: 15 },
  stage: { position: 'relative', width: '100%', aspectRatio: '4 / 3', background: '#111', borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  video: { width: '100%', height: '100%', objectFit: 'cover' },
  reticle: { position: 'absolute', left: '12%', right: '12%', top: '40%', height: '20%', border: '2px solid rgba(255,255,255,0.9)', borderRadius: 10, boxShadow: '0 0 0 100vh rgba(0,0,0,0.15)' },
  placeholder: { color: '#e5e7eb', fontSize: 13, textAlign: 'center', padding: 24, lineHeight: 1.5 },
  note: { marginTop: 10, fontSize: 12.5, color: '#6b5b2e', background: '#fbf6e8', border: '1px solid #efe2bd', borderRadius: 8, padding: '8px 10px' },
  retryBtn: { display: 'block', width: '100%', minHeight: 44, marginTop: 12, borderRadius: 10, background: '#3b5bdb', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  photoBtn: { display: 'block', textAlign: 'center', marginTop: 12, padding: '13px 12px', minHeight: 44, borderRadius: 10, background: '#f5f6fb', color: '#3b5bdb', border: '1px solid #d6def9', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  manualRow: { display: 'flex', gap: 8, marginTop: 12 },
  manualInput: { flex: 1, minWidth: 0, padding: '12px', minHeight: 44, fontSize: 14, borderRadius: 10, border: '1px solid #d1d5db', outline: 'none' },
  manualSend: { padding: '0 16px', minHeight: 44, borderRadius: 10, border: 'none', background: '#3b5bdb', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  hint: { marginTop: 8, fontSize: 11.5, color: '#9ca3af', textAlign: 'center' },
};
