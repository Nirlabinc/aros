import { CATALOG_STATE_COPY, type CatalogState } from './attachments';

/**
 * The honest barcode-outcome card. Every non-`found` catalog state gets its own
 * title, body, AND call to action — previously `not-connected` rendered as a
 * bare sentence with the CTA dropped on the floor, and `not-found` /
 * `catalog-unreachable` had no renderer at all, so two of the journey's
 * documented failure states could not appear on screen.
 *
 * `found` renders nothing: a real hit is the model's own grounded answer in the
 * transcript. This component never displays product data, so it can never
 * invent a product.
 */
export function CatalogNotice({ state, upc, onAction }: { state: CatalogState; upc?: string; onAction?: (state: Exclude<CatalogState, 'found'>) => void }) {
  if (state === 'found') return null;
  const copy = CATALOG_STATE_COPY[state];
  return (
    <div style={S.card} data-catalog-state={state}>
      <div style={S.title}>{copy.title}</div>
      <div style={S.body}>
        {copy.body}
        {upc ? <span style={S.upc}> (UPC {upc})</span> : null}
      </div>
      {onAction && (
        <button type="button" style={S.cta} onClick={() => onAction(state)}>{copy.cta}</button>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  card: { marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fbfbfd', padding: '12px 14px', fontFamily: 'inherit' },
  title: { fontSize: 13.5, fontWeight: 700, color: '#1a1a2e' },
  body: { fontSize: 12.5, color: '#6b7280', lineHeight: 1.5, marginTop: 3 },
  upc: { fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11.5 },
  cta: { marginTop: 10, minHeight: 44, padding: '0 16px', borderRadius: 10, border: '1px solid #d6def9', background: '#f5f6fb', color: '#3b5bdb', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
};
