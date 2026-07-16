import { SKILLS, AGENTS, SECTION_TITLES, type SectionKey, type CapabilityCard } from './shellData';

function CardGrid({ cards, cta }: { cards: CapabilityCard[]; cta: string }) {
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
            <span className={`aros-badge ${c.on ? 'aros-badge--on' : 'aros-badge--off'}`}>{c.tag}</span>
            <button className="rsx-card__btn" type="button">{c.on ? 'Configure' : cta}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Section content for the non-chat nav items. Skills and Agents render real
 * capability cards (wire to CapabilityCatalog kind="skills"/"agents"); the
 * others are lightweight placeholders that map to existing surfaces
 * (Stores/Apps → ConnectionsHub, Models → AIModels, Health → ConnectionHealth).
 */
export function SectionPanel({ section }: { section: SectionKey }) {
  if (section === 'skills') {
    return (
      <div className="aros-panel">
        <p className="aros-panel__lead">Reusable skills your agents can call — each one gated so nothing changes your stores without approval. Turn one on and Shre can use it in chat immediately.</p>
        <CardGrid cards={SKILLS} cta="Enable" />
      </div>
    );
  }
  if (section === 'agents') {
    return (
      <div className="aros-panel">
        <p className="aros-panel__lead">Always-on agents that watch your stores and act within the scope you grant. Talk to any of them from chat, or let them run in the background and report back.</p>
        <CardGrid cards={AGENTS} cta="Start" />
      </div>
    );
  }
  const maps: Partial<Record<SectionKey, string>> = {
    stores: 'Connect and manage your POS registers here (RapidRMS, Verifone, Azure SQL).',
    apps: 'Connect the apps Shre can read and act in — accounting, e-commerce, messaging.',
    models: 'Choose the AUM model and per-conversation overrides that power your agents.',
    permissions: 'Control what each role and agent may read and change, per store.',
    health: 'Live status of every connected register and app — 2 healthy, 1 degraded, 1 down.',
    team: 'Invite teammates and set their roles across your workspace.',
    billing: 'Plan, usage, and invoices for your AROS workspace.',
    usage: 'Model spend, calls, and per-agent usage over time.',
    settings: 'Workspace name, branding, and account preferences.',
  };
  return (
    <div className="aros-panel">
      <p className="aros-panel__lead">{maps[section] || 'Coming soon.'}</p>
      <div className="rsx-card" style={{ maxWidth: 420 }}>
        <div className="rsx-card__top">
          <div className="rsx-card__icon">🔗</div>
          <div className="rsx-card__title">{SECTION_TITLES[section]}</div>
        </div>
        <div className="rsx-card__desc">This section wires to the existing AROS surface. Preview shows the shell and navigation; live data lands when we connect it.</div>
      </div>
    </div>
  );
}
