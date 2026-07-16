import { type SectionKey, type Card, type Row, type FormField } from './shellData';
import { useSection } from './data';

function StatRow({ stats }: { stats: { value: string | number; label: string }[] }) {
  return (
    <div className="rsx-stats">
      {stats.map(st => (
        <div key={st.label} className="rsx-stat">
          <strong>{st.value}</strong>
          <span>{st.label}</span>
        </div>
      ))}
    </div>
  );
}

function CardGrid({ cards }: { cards: Card[] }) {
  return (
    <div className="rsx-cards">
      {cards.map(c => (
        <div key={c.title} className="rsx-card">
          <div className="rsx-card__top">
            <div className="rsx-card__icon">{c.icon}</div>
            <div className="rsx-card__title">{c.title}</div>
          </div>
          <div className="rsx-card__desc">{c.desc}</div>
          <div className="rsx-card__foot">
            <span className={`rsx-badge rsx-badge--${c.status}`}>{c.tag}</span>
            <button className="rsx-card__btn" type="button">{c.cta}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RowList({ rows }: { rows: Row[] }) {
  return (
    <div className="rsx-rows">
      {rows.map(r => (
        <div key={r.title} className="rsx-row">
          <div className="rsx-row__mark">{r.mark}</div>
          <div className="rsx-row__info">
            <div className="rsx-row__title">{r.title}</div>
            <div className="rsx-row__sub">{r.sub}</div>
          </div>
          <span className={`rsx-pill rsx-pill--${r.status}`}>{r.statusLabel}</span>
          <button className="rsx-row__btn" type="button">{r.action}</button>
        </div>
      ))}
    </div>
  );
}

function FormPanel({ fields }: { fields: FormField[] }) {
  return (
    <div className="rsx-form">
      {fields.map(f => (
        <label key={f.label} className="rsx-form__field">
          <span className="rsx-form__label">{f.label}</span>
          {f.type === 'select' ? (
            <select className="rsx-form__input" defaultValue={f.value}>
              {(f.options || []).map(o => <option key={o}>{o}</option>)}
            </select>
          ) : (
            <input className="rsx-form__input" defaultValue={f.value} />
          )}
        </label>
      ))}
    </div>
  );
}

/**
 * Renders a section's content in the chat-first design. Data comes from
 * shellData.SECTIONS, which mirrors the app's real catalogs (skills/agents,
 * POS/app providers, models, members). Cutover swaps these static specs for
 * live fetches — the render layer stays the same.
 */
export function SectionPanel({ section, onConnect }: { section: Exclude<SectionKey, 'chat'>; onConnect?: () => void }) {
  const { spec, loading } = useSection(section);
  const ctaOpensWizard = section === 'stores';
  const cta = spec.primaryCta && (
    <button className="rsx-panel__cta" type="button" onClick={ctaOpensWizard ? onConnect : undefined}>{spec.primaryCta}</button>
  );
  const hasContent = !!(spec.stats?.length || spec.cards?.length || spec.rows?.length || spec.form?.length || spec.note);
  return (
    <div className="rsx-panel">
      <div className="rsx-panel__head">
        <div>
          <div className="rsx-panel__eyebrow">{spec.eyebrow}</div>
          <p className="rsx-panel__lead">{spec.lead}</p>
        </div>
        {cta}
      </div>

      {loading ? (
        <div className="rsx2-empty"><div className="rsx2-empty__text">Loading…</div></div>
      ) : !hasContent ? (
        <div className="rsx2-empty">
          <div className="rsx2-empty__icon">◇</div>
          <div className="rsx2-empty__title">Nothing here yet</div>
          <div className="rsx2-empty__text">Once you connect your data, this appears automatically.</div>
          {ctaOpensWizard && spec.primaryCta && <button className="rsx-panel__cta" type="button" onClick={onConnect}>{spec.primaryCta}</button>}
        </div>
      ) : (
        <>
          {spec.stats && <StatRow stats={spec.stats} />}
          {spec.cards && <CardGrid cards={spec.cards} />}
          {spec.rows && <RowList rows={spec.rows} />}
          {spec.form && <FormPanel fields={spec.form} />}
          {spec.note && (
            <div className="rsx-note">
              <div className="rsx-note__title">✓ {spec.note.title}</div>
              <div className="rsx-note__body">{spec.note.body}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
