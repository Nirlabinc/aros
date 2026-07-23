import { Attachment, formatBytes, isImage } from './attachments';

/**
 * Renders attachment thumbnails — the pending strip inside a composer (with a
 * remove control) and the read-only thumbnails shown in the transcript. Images
 * show a real preview; documents show a labeled file chip.
 *
 * `onRemove` takes the attachment's stable `id`, NOT its index. A closed-over
 * index goes stale the instant the list shifts, so a double-tap on the ✕ used
 * to delete two files (the second click removed whatever slid into that slot).
 */
export function AttachmentThumbs({ attachments, onRemove, size = 56 }: { attachments: Attachment[]; onRemove?: (id: string) => void; size?: number }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div style={{ ...S.strip, ...(onRemove ? S.stripRemovable : {}) }}>
      {attachments.map((a, i) => (
        <div key={a.id || `${a.name}-${i}`} style={{ ...S.item, width: size, height: size }} title={`${a.name} · ${formatBytes(a.size)}`}>
          <div style={S.clip}>
            {isImage(a.type) && a.dataUrl ? (
              <img src={a.dataUrl} alt={a.name} style={S.img} />
            ) : (
              <div style={S.doc}>
                <span style={S.docExt}>{docLabel(a)}</span>
              </div>
            )}
          </div>
          {onRemove && (
            // 44×44 touch target (WCAG 2.5.5) with a small visual badge inside;
            // the old control was an 18px dot, unhittable with a thumb.
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => onRemove(a.id)}
              style={S.removeHit}
            >
              <span aria-hidden style={S.removeDot}>✕</span>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function docLabel(a: Attachment): string {
  const fromName = a.name.includes('.') ? a.name.split('.').pop() : '';
  if (fromName) return fromName.slice(0, 4).toUpperCase();
  const t = a.type.split('/').pop() || 'FILE';
  return t.slice(0, 4).toUpperCase();
}

const S: Record<string, React.CSSProperties> = {
  strip: { display: 'flex', flexWrap: 'wrap', gap: 8, padding: '6px 0' },
  // Extra room so the overhanging 44px remove targets don't collide.
  stripRemovable: { gap: 16, padding: '14px 0 6px' },
  item: { position: 'relative', borderRadius: 10, border: '1px solid #e5e7eb', background: '#f5f6fb', flexShrink: 0 },
  clip: { width: '100%', height: '100%', borderRadius: 10, overflow: 'hidden' },
  img: { width: '100%', height: '100%', objectFit: 'cover' },
  doc: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  docExt: { fontSize: 10, fontWeight: 800, color: '#6b7280', letterSpacing: 0.5 },
  removeHit: { position: 'absolute', top: -14, right: -14, width: 44, height: 44, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  removeDot: { width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: 11, lineHeight: '22px', textAlign: 'center', display: 'block', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' },
};
