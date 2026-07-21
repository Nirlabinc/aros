import { useState } from 'react';
import { useIdentity, useHomeData, useOwnerDigest, useDigestActionRecorder, type OwnerBrief, type BriefCtaType } from './data';

// Home — the calm retail "command home". Content comes from useHomeData: rich
// demo data in preview, real/empty data in a live build (never the demo persona).

export function Home({ onAskShre, onConnect, onSection }: {
  onAskShre: (q?: string) => void;
  onConnect: () => void;
  onSection: (k: 'skills' | 'agents' | 'stores') => void;
}) {
  const id = useIdentity();
  const data = useHomeData();
  const brief = useOwnerDigest();
  const hour = 12; // no Date in preview harness; a fixed, safe greeting.
  const partOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

  return (
    <div className="rsx2-home">
      <div className="rsx2-home__inner">
        <div className="rsx2-home__greeting">
          <div className="rsx2-home__hi">Good {partOfDay}, {id.name.split(' ')[0]}.</div>
          <div className="rsx2-home__sub">{data.greetingSub}</div>
        </div>

        <button className="rsx2-ask" onClick={() => onAskShre()}>
          <span className="rsx2-ask__mark">S</span>
          <span className="rsx2-ask__text">Ask Shre anything — “How were sales yesterday?”</span>
          <span className="rsx2-ask__cue">↵</span>
        </button>
        <div className="rsx2-home__chips">
          {data.suggestions.map(q => (
            <button key={q} className="aros-suggest__btn" onClick={() => onAskShre(q)}>{q}</button>
          ))}
        </div>

        <WeeklyBrief brief={brief} hasPos={data.dataState !== 'none'} />

        {data.kpis.length > 0 && (
          <div className="rsx2-home__kpis">
            {data.kpis.map(k => (
              <div key={k.label} className="rsx2-kpi">
                <div className="rsx2-kpi__value">{k.value}</div>
                <div className="rsx2-kpi__label">{k.label}</div>
                <div className={`rsx2-kpi__delta ${k.up ? 'is-up' : ''}`}>{k.delta}</div>
              </div>
            ))}
          </div>
        )}

        <div className="rsx2-home__grid">
          <section className="rsx2-panelcard">
            <div className="rsx2-panelcard__head"><h3>Needs your approval</h3>{data.approvals.length > 0 && <span className="rsx-nav__count">{data.approvals.length}</span>}</div>
            {data.approvals.length === 0
              ? <div className="rsx2-empty"><div className="rsx2-empty__text">Nothing waiting on you.</div></div>
              : data.approvals.map(a => (
                <div key={a.title} className="rsx2-feed">
                  <span className="rsx2-feed__icon">{a.icon}</span>
                  <div className="rsx2-feed__body">
                    <div className="rsx2-feed__title">{a.title}</div>
                    <div className="rsx2-feed__meta">{a.by} · {a.when}</div>
                  </div>
                  <div className="rsx2-feed__acts"><button className="rsx2-feed__approve" onClick={() => onAskShre(a.title)}>Review</button></div>
                </div>
              ))}
          </section>

          <section className="rsx2-panelcard">
            <div className="rsx2-panelcard__head"><h3>What Shre did</h3>{data.activity.length > 0 && <span className="rsx2-canvas__src">today</span>}</div>
            {data.activity.length === 0
              ? <div className="rsx2-empty"><div className="rsx2-empty__text">{data.dataState === 'syncing'
                  ? 'Store connected — your latest numbers are on the way.'
                  : data.dataState === 'connected'
                    ? 'Store connected — dashboard numbers for this register type are coming soon.'
                    : 'Activity will appear here once your stores are connected.'}</div></div>
              : data.activity.map(a => (
                <div key={a.text} className="rsx2-feed">
                  <span className="rsx2-feed__icon">{a.icon}</span>
                  <div className="rsx2-feed__body">
                    <div className="rsx2-feed__title" style={{ fontWeight: 500 }}>{a.text}</div>
                    <div className="rsx2-feed__meta">{a.when}</div>
                  </div>
                </div>
              ))}
          </section>
        </div>

        <div className="rsx2-home__actions">
          <QuickAction icon="🛒" label={data.dataState === 'none' ? 'Connect a register' : 'Manage connections'} hint="RapidRMS or Verifone" onClick={onConnect} />
          <QuickAction icon="⚡" label="Browse skills" hint="Automate your store" onClick={() => onSection('skills')} />
          <QuickAction icon="🤖" label="View agents" hint="Always-on helpers" onClick={() => onSection('agents')} />
        </div>
      </div>
    </div>
  );
}

// One primary action per CTA type. There is no in-app pricing / purchase-order
// / campaign surface yet (audited 2026-07: the shell routes are stores / apps /
// skills / agents / models / admin), so every CTA opens the digest's own rows
// in an expander inside the card — no invented pages, no dead links. When a
// real destination ships, route here instead and keep the tap recording.
const CTA_LABELS: Record<BriefCtaType, string> = {
  fix_price: 'Review pricing',
  draft_po: 'Start reorder',
  draft_campaign: 'Plan a promo',
  buy_review: 'Review details',
  review: 'Review details',
};

// Weekly Owner Brief — renders only when a digest exists (useOwnerDigest maps
// every missing/failed state to null). With a connected POS but no digest yet,
// a single quiet line; with no POS at all, nothing.
function WeeklyBrief({ brief, hasPos }: { brief: OwnerBrief | null; hasPos: boolean }) {
  const recordTap = useDigestActionRecorder();
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!brief) {
    return hasPos ? <div className="rsx2-brief__pending">Your weekly brief arrives Monday.</div> : null;
  }
  const counts = [
    brief.leakCount > 0 ? `${brief.leakCount} margin leak${brief.leakCount === 1 ? '' : 's'}` : null,
    brief.reorderCount > 0
      ? `${brief.reorderCount} item${brief.reorderCount === 1 ? '' : 's'} to reorder${brief.reorderCost != null ? ` (~$${brief.reorderCost.toLocaleString()})` : ''}`
      : null,
    brief.deadStockCapital != null && brief.deadStockCapital > 0 ? `$${brief.deadStockCapital.toLocaleString()} tied up in dead stock` : null,
  ].filter(Boolean) as string[];

  return (
    <section className="rsx2-panelcard rsx2-brief">
      <div className="rsx2-panelcard__head">
        <h3>Weekly Brief</h3>
        {brief.periodEnd && <span className="rsx2-canvas__src">week ending {brief.periodEnd}</span>}
      </div>
      <div className="rsx2-home__kpis rsx2-brief__kpis">
        {brief.tiles.map(t => (
          <div key={t.label} className="rsx2-kpi">
            <div className="rsx2-kpi__value">{t.value}</div>
            <div className="rsx2-kpi__label">{t.label}</div>
            <div className={`rsx2-kpi__delta ${t.up ? 'is-up' : ''} ${t.down ? 'is-down' : ''}`}>{t.delta}</div>
          </div>
        ))}
      </div>
      {brief.action && (
        <div className="rsx2-brief__action">
          <span className="rsx2-brief__actiontag">Do this today</span>
          <div className="rsx2-feed__body">
            <div className="rsx2-feed__title">{brief.action}</div>
            {brief.reason && <div className="rsx2-feed__meta">{brief.reason}</div>}
          </div>
          {brief.cta && brief.details.length > 0 && (
            <div className="rsx2-feed__acts">
              <button
                className="rsx2-feed__approve"
                aria-expanded={detailsOpen}
                onClick={() => {
                  if (!detailsOpen && brief.cta) recordTap(brief.cta); // tap = intent to act; closing isn't one
                  setDetailsOpen(open => !open);
                }}
              >{detailsOpen ? 'Hide details' : CTA_LABELS[brief.cta.type]}</button>
            </div>
          )}
        </div>
      )}
      {detailsOpen && brief.details.length > 0 && (
        <div className="rsx2-brief__details">
          {brief.details.map((d, i) => (
            <div key={`${i}-${d.title}`} className="rsx2-brief__detail">
              <div className="rsx2-feed__title">{d.title}</div>
              {d.meta && <div className="rsx2-feed__meta">{d.meta}</div>}
            </div>
          ))}
        </div>
      )}
      {counts.length > 0 && <div className="rsx2-brief__counts">{counts.join(' · ')}</div>}
    </section>
  );
}

function QuickAction({ icon, label, hint, onClick }: { icon: string; label: string; hint: string; onClick: () => void }) {
  return (
    <button className="rsx2-quick" onClick={onClick}>
      <span className="rsx2-quick__icon">{icon}</span>
      <span className="rsx2-quick__label">{label}</span>
      <span className="rsx2-quick__hint">{hint}</span>
    </button>
  );
}
