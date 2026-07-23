import { useRef, useState, type ReactNode } from 'react';
import { Attachment, ATTACH_ACCEPT, checkCap, DOC_MIME, isAllowedType } from './attachments';
import { encodeAttachment } from './encode';
import { BarcodeScanner } from './BarcodeScanner';

const DOC_ACCEPT = DOC_MIME.join(',');

/**
 * The one "attach" affordance shared by all three AROS composers (Concierge,
 * FAB, Start). A single "+" button opens a sheet: Photo · File · Camera ·
 * Barcode · Voice. Self-contained inline styles so it drops into each
 * composer's own styling system unchanged.
 *
 *  - onAttach   receives encoded, cap-checked attachments to send.
 *  - onBarcode  receives a decoded/typed UPC (host resolves it in the catalog).
 *  - onError    surfaces graceful over-cap / rejected-type messages.
 *  - voiceSlot  mounts the shared voice-everywhere component (see stm-voice-
 *               everywhere); when absent the row is clearly marked "coming soon"
 *               and never fakes recording.
 */
export function AttachSheet({
  existing,
  onAttach,
  onBarcode,
  onError,
  voiceSlot,
  disabled,
  accent = '#3b5bdb',
}: {
  existing: Attachment[];
  onAttach: (a: Attachment[]) => void;
  onBarcode: (upc: string) => void;
  onError: (msg: string) => void;
  voiceSlot?: ReactNode;
  disabled?: boolean;
  accent?: string;
}) {
  const [openSheet, setOpenSheet] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  async function ingest(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    const accepted: Attachment[] = [];
    const running = [...existing];
    for (const file of Array.from(files)) {
      if (!isAllowedType(file.type)) {
        onError(`${file.name || 'That file'} is not a supported type. Attach an image, PDF, or Office/CSV document.`);
        continue;
      }
      try {
        const att = await encodeAttachment(file);
        const cap = checkCap(running, att.size, att.name);
        if (!cap.ok) { onError(cap.reason); continue; }
        accepted.push(att);
        running.push(att);
      } catch {
        onError(`Could not read ${file.name || 'that file'}. Try a different file.`);
      }
    }
    setBusy(false);
    if (accepted.length) onAttach(accepted);
  }

  function pick(ref: React.RefObject<HTMLInputElement | null>) {
    setOpenSheet(false);
    ref.current?.click();
  }

  const items: { key: string; label: string; icon: ReactNode; onClick?: () => void; node?: ReactNode; muted?: boolean }[] = [
    { key: 'photo', label: 'Photo', icon: <IconImage />, onClick: () => pick(photoRef) },
    { key: 'file', label: 'File', icon: <IconFile />, onClick: () => pick(fileRef) },
    { key: 'camera', label: 'Camera', icon: <IconCamera />, onClick: () => pick(cameraRef) },
    { key: 'barcode', label: 'Barcode', icon: <IconBarcode />, onClick: () => { setOpenSheet(false); setScanning(true); } },
    voiceSlot
      ? { key: 'voice', label: 'Voice', icon: <IconMic />, node: voiceSlot }
      : { key: 'voice', label: 'Voice · coming soon', icon: <IconMic />, muted: true },
  ];

  return (
    <>
      <button
        type="button"
        aria-label="Add an attachment"
        aria-haspopup="menu"
        aria-expanded={openSheet}
        disabled={disabled || busy}
        onClick={() => setOpenSheet((v) => !v)}
        style={{ ...S.trigger, color: openSheet ? accent : '#6b7280', opacity: disabled ? 0.5 : 1 }}
        title="Attach a photo, file, camera shot, or barcode"
      >
        {busy ? <IconSpinner /> : <IconPlus />}
      </button>

      {openSheet && (
        <>
          <div style={S.scrim} onClick={() => setOpenSheet(false)} aria-hidden />
          <div role="menu" style={S.menu}>
            {items.map((it) => (
              <div key={it.key} role="menuitem" style={{ ...S.row, ...(it.muted ? S.rowMuted : {}) }} onClick={it.onClick}>
                <span style={{ ...S.rowIcon, color: it.muted ? '#9ca3af' : accent }}>{it.icon}</span>
                <span style={S.rowLabel}>{it.label}</span>
                {it.node && <span style={{ marginLeft: 'auto' }}>{it.node}</span>}
              </div>
            ))}
            {/* TODO(voice-everywhere): replace the muted Voice row above with the
                shared recorder via the onTranscript/onSend contract (stm-voice-everywhere). */}
          </div>
        </>
      )}

      {/* Hidden inputs — one per source. Camera uses capture=environment. */}
      <input ref={photoRef} type="file" accept="image/*" multiple onChange={(e) => { const f = e.target.files; e.target.value = ''; void ingest(f); }} style={{ display: 'none' }} />
      <input ref={fileRef} type="file" accept={DOC_ACCEPT || ATTACH_ACCEPT} multiple onChange={(e) => { const f = e.target.files; e.target.value = ''; void ingest(f); }} style={{ display: 'none' }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files; e.target.value = ''; void ingest(f); }} style={{ display: 'none' }} />

      <BarcodeScanner open={scanning} onClose={() => setScanning(false)} onDetected={(upc) => { setScanning(false); onBarcode(upc); }} />
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  trigger: { position: 'relative', width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer' },
  scrim: { position: 'fixed', inset: 0, zIndex: 10000 },
  menu: { position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 10001, minWidth: 200, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', boxShadow: '0 12px 40px rgba(0,0,0,0.16)', padding: 6, fontFamily: 'Inter, system-ui, sans-serif' },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, cursor: 'pointer', color: '#1a1a2e', fontSize: 13.5 },
  rowMuted: { cursor: 'default' },
  rowIcon: { display: 'flex', width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontWeight: 500 },
};

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function IconPlus() { return <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }
function IconImage() { return <svg width="17" height="17" viewBox="0 0 24 24" {...stroke}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>; }
function IconFile() { return <svg width="17" height="17" viewBox="0 0 24 24" {...stroke}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>; }
function IconCamera() { return <svg width="17" height="17" viewBox="0 0 24 24" {...stroke}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>; }
function IconBarcode() { return <svg width="17" height="17" viewBox="0 0 24 24" {...stroke}><path d="M3 5v14M7 5v14M11 5v14M14 5v14M17 5v14M21 5v14" /></svg>; }
function IconMic() { return <svg width="17" height="17" viewBox="0 0 24 24" {...stroke}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg>; }
function IconSpinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" opacity="0.9" />
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite" />
    </svg>
  );
}
