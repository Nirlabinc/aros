import { Attachment, formatBytes, isImage } from './attachments';

/**
 * Renders attachment thumbnails — the pending strip inside a composer (with a
 * remove control) and the read-only thumbnails shown in the transcript. Images
 * show a real preview; documents show a labeled file chip.
 */
export function AttachmentThumbs({ attachments, onRemove, size = 56 }: { attachments: Attachment[]; onRemove?: (index: number) => void; size?: number }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div style={S.strip}>
      {attachments.map((a, i) => (
        <div key={`${a.name}-${i}`} style={{ ...S.item, width: size, height: size }} title={`${a.name} · ${formatBytes(a.size)}`}>
          {isImage(a.type) && a.dataUrl ? (
            <img src={a.dataUrl} alt={a.name} style={S.img} />
          ) : (
            <div style={S.doc}>
              <span style={S.docExt}>{docLabel(a)}</span>
            </div>
          )}
          {onRemove && (
            <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onRemove(i)} style={S.remove}>✕</button>
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
  item: { position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb', background: '#f5f6fb', flexShrink: 0 },
  img: { width: '100%', height: '100%', objectFit: 'cover' },
  doc: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  docExt: { fontSize: 10, fontWeight: 800, color: '#6b7280', letterSpacing: 0.5 },
  remove: { position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, lineHeight: '18px', cursor: 'pointer', padding: 0 },
};
