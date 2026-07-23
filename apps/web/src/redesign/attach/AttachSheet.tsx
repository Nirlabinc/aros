import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Attachment,
  ATTACH_ACCEPT,
  IMAGE_ACCEPT,
  checkCap,
  isAllowedType,
  resolveType,
} from './attachments';
import { EncodeError, encodeAttachment } from './encode';
import { BarcodeScanner } from './BarcodeScanner';

/** Shown when the camera path returns nothing — a denial and a dismissal look
 *  identical to the page, so the copy offers BOTH recoveries. */
const CAMERA_EMPTY_MESSAGE =
  'No photo came back from the camera. If your browser blocked camera access, allow it in the address-bar site settings and tap Camera again — or use Photo to pick an existing picture.';

/**
 * The one "attach" affordance shared by all three AROS composers (Concierge,
 * FAB, Start). A single "+" button opens a menu: Photo · File · Camera ·
 * Barcode · Voice. Self-contained inline styles so it drops into each
 * composer's own styling system unchanged.
 *
 *  - onAttach     receives encoded, cap-checked attachments to send.
 *  - onBarcode    receives a decoded/typed UPC (host resolves it in the catalog).
 *  - onError      surfaces one message per rejected file (never a collapsing
 *                 single string — three bad files produce three reasons).
 *  - onBusyChange lets the host BLOCK SEND while files are still encoding; a
 *                 send fired mid-encode silently drops the attachment.
 *  - voiceSlot    mounts the shared voice-everywhere component. `voiceRow` is
 *                 'hidden' on surfaces that already show a working mic — a
 *                 "coming soon" row beside a live mic button is a lie.
 */
export function AttachSheet({
  existing,
  onAttach,
  onBarcode,
  onError,
  onBusyChange,
  voiceSlot,
  voiceRow = 'coming-soon',
  disabled,
  accent = '#3b5bdb',
}: {
  existing: Attachment[];
  onAttach: (a: Attachment[]) => void;
  onBarcode: (upc: string) => void;
  onError: (msgs: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
  voiceSlot?: ReactNode;
  voiceRow?: 'coming-soon' | 'hidden';
  disabled?: boolean;
  accent?: string;
}) {
  const [openSheet, setOpenSheet] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // A `capture=` picker returns an empty FileList on both "cancel" and
  // "permission denied", and the browser tells us nothing else — so we detect
  // the empty return and offer BOTH recoveries instead of going silent.
  const cameraPendingRef = useRef(false);

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  // Hosts pass inline callbacks; keep the listener below from re-binding on
  // every render.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // A blocked or dismissed camera fires `cancel`, never `change` — without this
  // the Camera row was completely silent on denial and the user was left
  // tapping a button that appeared to do nothing.
  useEffect(() => {
    const el = cameraRef.current;
    if (!el) return;
    const onCancel = () => {
      if (!cameraPendingRef.current) return;
      cameraPendingRef.current = false;
      onErrorRef.current([CAMERA_EMPTY_MESSAGE]);
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, []);

  async function ingest(files: File[], source: 'photo' | 'file' | 'camera') {
    if (source === 'camera') {
      const cancelled = cameraPendingRef.current && files.length === 0;
      cameraPendingRef.current = false;
      if (cancelled) {
        onError([CAMERA_EMPTY_MESSAGE]);
        return;
      }
    }
    if (files.length === 0) return;

    setBusy(true);
    const accepted: Attachment[] = [];
    const errors: string[] = [];
    const running = [...existing];
    try {
      for (const file of files) {
        const label = file.name || 'That file';
        const type = resolveType(file.name || '', file.type || '');
        if (!type || !isAllowedType(type)) {
          errors.push(`${label} is not a supported type. Attach an image, a PDF, or a modern Office/CSV document (.docx, .xlsx, .pptx, .csv, .txt).`);
          continue;
        }
        // Cap on file.size FIRST. Encoding a 500 MB pick to base64 before
        // measuring it balloons the tab into an OOM crash — the cap has to
        // reject it while it is still a file handle.
        const preCap = checkCap(running, file.size, label);
        if (!preCap.ok) { errors.push(preCap.reason); continue; }
        try {
          const att = await encodeAttachment(file);
          // Re-check after encode: downscaling shrinks images, base64 grows
          // everything, so the authoritative number is the encoded one.
          const cap = checkCap(running, att.size, label);
          if (!cap.ok) { errors.push(cap.reason); continue; }
          accepted.push(att);
          running.push(att);
        } catch (err) {
          errors.push(err instanceof EncodeError ? err.message : `Could not read ${label}. Try a different file.`);
        }
      }
    } finally {
      setBusy(false);
    }
    if (accepted.length) onAttach(accepted);
    if (errors.length) onError(errors);
  }

  const closeSheet = useCallback((restoreFocus = true) => {
    setOpenSheet(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  function pick(ref: React.RefObject<HTMLInputElement | null>, isCamera = false) {
    setOpenSheet(false);
    if (isCamera) cameraPendingRef.current = true;
    ref.current?.click();
  }

  type Item = { key: string; label: string; icon: ReactNode; onSelect?: () => void; node?: ReactNode; muted?: boolean };
  const items: Item[] = [
    { key: 'photo', label: 'Photo', icon: <IconImage />, onSelect: () => pick(photoRef) },
    { key: 'file', label: 'File', icon: <IconFile />, onSelect: () => pick(fileRef) },
    { key: 'camera', label: 'Camera', icon: <IconCamera />, onSelect: () => pick(cameraRef, true) },
    { key: 'barcode', label: 'Barcode', icon: <IconBarcode />, onSelect: () => { setOpenSheet(false); setScanning(true); } },
  ];
  if (voiceSlot) items.push({ key: 'voice', label: 'Voice', icon: <IconMic />, node: voiceSlot });
  else if (voiceRow === 'coming-soon') items.push({ key: 'voice', label: 'Voice · coming soon', icon: <IconMic />, muted: true });

  // Move focus into the menu on open and restore it on close (R2). Without
  // this a keyboard user tabs into the page behind the menu.
  useEffect(() => {
    if (!openSheet) return;
    const first = itemRefs.current.find(Boolean);
    first?.focus();
  }, [openSheet]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const focusable = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    if (focusable.length === 0) return;
    const current = focusable.indexOf(document.activeElement as HTMLButtonElement);
    const move = (next: number) => { e.preventDefault(); focusable[(next + focusable.length) % focusable.length].focus(); };
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(); return; }
    if (e.key === 'ArrowDown') return move(current + 1);
    if (e.key === 'ArrowUp') return move(current - 1);
    if (e.key === 'Home') return move(0);
    if (e.key === 'End') return move(focusable.length - 1);
    if (e.key === 'Tab') { e.preventDefault(); return move(current + (e.shiftKey ? -1 : 1)); }
  }

  return (
    // The menu is positioned against THIS wrapper. Without a positioned
    // ancestor `bottom: calc(100% + 8px)` resolves against the nearest
    // positioned block (or the viewport), which put the menu offscreen on all
    // three composers and made the whole feature unreachable. Same pattern the
    // shell already uses for .rsx2-top__menu / .rsx2-top__pop.
    <span style={S.wrap}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Add an attachment"
        aria-haspopup="menu"
        aria-expanded={openSheet}
        disabled={disabled || busy}
        onClick={() => setOpenSheet((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Escape' && openSheet) { e.preventDefault(); closeSheet(); } }}
        style={{ ...S.trigger, color: openSheet ? accent : '#6b7280', opacity: disabled ? 0.5 : 1 }}
        title="Attach a photo, file, camera shot, or barcode"
      >
        {busy ? <IconSpinner /> : <IconPlus />}
      </button>

      {busy && <span role="status" aria-live="polite" style={S.srOnly}>Reading your file…</span>}

      {openSheet && (
        <>
          <div style={S.scrim} onClick={() => closeSheet()} aria-hidden />
          <div ref={menuRef} role="menu" aria-label="Attach" style={S.menu} onKeyDown={onMenuKeyDown}>
            {items.map((it, i) => (
              it.muted ? (
                <button
                  key={it.key}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  type="button"
                  role="menuitem"
                  aria-disabled="true"
                  onClick={(e) => e.preventDefault()}
                  style={{ ...S.row, ...S.rowMuted }}
                >
                  <span style={{ ...S.rowIcon, color: '#9ca3af' }}>{it.icon}</span>
                  {/* The LABEL is muted too — greying only the icon reads as an
                      enabled row with a faded picture. */}
                  <span style={{ ...S.rowLabel, color: '#9ca3af' }}>{it.label}</span>
                </button>
              ) : (
                <button
                  key={it.key}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  type="button"
                  role="menuitem"
                  onClick={it.onSelect}
                  style={S.row}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f6fb'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ ...S.rowIcon, color: accent }}>{it.icon}</span>
                  <span style={S.rowLabel}>{it.label}</span>
                  {it.node && <span style={{ marginLeft: 'auto' }}>{it.node}</span>}
                </button>
              )
            ))}
            {/* TODO(voice-everywhere): replace the muted Voice row above with the
                shared recorder via the onTranscript/onSend contract (stm-voice-
                everywhere). Surfaces that already ship a mic pass voiceRow="hidden". */}
          </div>
        </>
      )}

      {/* Hidden inputs — one per source. Camera uses capture=environment.
          "File" accepts images too: a user who taps File to attach a screenshot
          must not find images greyed out in the picker.

          NOTE the Array.from BEFORE resetting `value`. `input.files` is a live
          FileList: clearing `value` empties it, so capturing the FileList and
          then resetting handed the ingest loop an empty list and every single
          pick silently vanished. Snapshot to a real array first. */}
      <input ref={photoRef} type="file" accept={IMAGE_ACCEPT} multiple onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; void ingest(f, 'photo'); }} style={{ display: 'none' }} />
      <input ref={fileRef} type="file" accept={ATTACH_ACCEPT} multiple onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; void ingest(f, 'file'); }} style={{ display: 'none' }} />
      <input ref={cameraRef} type="file" accept={IMAGE_ACCEPT} capture="environment" onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; void ingest(f, 'camera'); }} style={{ display: 'none' }} />

      <BarcodeScanner open={scanning} onClose={() => { setScanning(false); triggerRef.current?.focus(); }} onDetected={(upc) => { setScanning(false); onBarcode(upc); }} />
    </span>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0 },
  trigger: { width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer' },
  scrim: { position: 'fixed', inset: 0, zIndex: 10000 },
  menu: { position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 10001, minWidth: 210, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', boxShadow: '0 12px 40px rgba(0,0,0,0.16)', padding: 6, fontFamily: 'Inter, system-ui, sans-serif' },
  row: { display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '11px 10px', minHeight: 44, borderRadius: 8, cursor: 'pointer', color: '#1a1a2e', fontSize: 13.5, background: 'transparent', border: 'none', textAlign: 'left', fontFamily: 'inherit' },
  rowMuted: { cursor: 'default' },
  rowIcon: { display: 'flex', width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontWeight: 500 },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
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
