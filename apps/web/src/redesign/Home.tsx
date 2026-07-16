import { useIdentity, useHomeData } from './data';

// Home — the calm retail "command home". Content comes from useHomeData: rich
// demo data in preview, real/empty data in a live build (never the demo persona).

export function Home({ onAskShre, onConnect, onSection }: {
  onAskShre: (q?: string) => void;
  onConnect: () => void;
  onSection: (k: 'skills' | 'agents' | 'stores') => void;
}) {
  const id = useIdentity();
  const data = useHomeData();
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
              ? <div className="rsx2-empty"><div className="rsx2-empty__text">Activity will appear here once your stores are connected.</div></div>
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
          <QuickAction icon="🛒" label="Connect a register" hint="RapidRMS or Verifone" onClick={onConnect} />
          <QuickAction icon="⚡" label="Browse skills" hint="Automate your store" onClick={() => onSection('skills')} />
          <QuickAction icon="🤖" label="View agents" hint="Always-on helpers" onClick={() => onSection('agents')} />
        </div>
      </div>
    </div>
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
