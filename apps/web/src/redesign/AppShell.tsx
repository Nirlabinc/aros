import { useState } from 'react';
import { useArosTheme } from '../lib/useArosTheme';
import { ConciergeChat } from './ConciergeChat';
import { SectionPanel } from './SectionPanel';
import {
  PRIMARY_NAV, WORKSPACE_NAV, HEALTH, USER, ROLES, SECTION_TITLES, type SectionKey, type NavItem,
} from './shellData';

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button className="rsx-nav" aria-current={active} onClick={onClick}>
      <span className="rsx-nav__glyph">{item.glyph}</span>
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.count != null && <span className="rsx-nav__count">{item.count}</span>}
    </button>
  );
}

/**
 * The chat-first app shell: left nav + Concierge/section content. Section state
 * is local for the preview; wired build maps sections to routes (chat=/start,
 * skills=/skills, agents=/agents, stores=/stores, …).
 */
export function AppShell() {
  const [section, setSection] = useState<SectionKey>('chat');
  const [role, setRole] = useState<string>(USER.role);
  const { label: themeLabel, toggle: toggleTheme } = useArosTheme();

  return (
    <div className="aros-shell">
      <aside className="aros-side">
        <div className="aros-side__brand">
          <div className="aros-side__mark">A</div>
          <div>
            <div className="aros-side__brandname">AROS</div>
            <div className="aros-side__brandby">by ShreAI</div>
          </div>
        </div>

        <nav aria-label="Primary">
          {PRIMARY_NAV.map(item => (
            <NavButton key={item.key} item={item} active={section === item.key} onClick={() => setSection(item.key)} />
          ))}
        </nav>

        <div className="aros-side__section">Workspace</div>
        <nav aria-label="Workspace">
          {WORKSPACE_NAV.map(item => (
            <NavButton key={item.key} item={item} active={section === item.key} onClick={() => setSection(item.key)} />
          ))}
        </nav>

        <div className="aros-side__spacer" />

        <div className="aros-health">
          <div className="aros-health__title">Connection Health</div>
          <div className="aros-health__row">
            <span className="aros-health__dot" style={{ background: 'var(--ok)' }} />
            <span className="aros-health__dot" style={{ background: 'var(--ok)' }} />
            <span className="aros-health__dot" style={{ background: 'var(--accent)' }} />
            <span className="aros-health__dot" style={{ background: 'var(--danger)' }} />
            <span className="aros-health__label">{HEALTH.healthy} healthy · {HEALTH.degraded} degraded · {HEALTH.down} down</span>
          </div>
        </div>

        <div className="aros-role">
          <div className="aros-role__label">Role · Demo</div>
          <div className="aros-role__pills">
            {ROLES.map(r => (
              <button key={r} className="aros-role__pill" aria-pressed={role === r} onClick={() => setRole(r)}>{r}</button>
            ))}
          </div>
        </div>

        <div className="aros-user">
          <div className="aros-user__avatar">{USER.initials}</div>
          <div>
            <div className="aros-user__name">{USER.name}</div>
            <div className="aros-user__meta">{role} · {USER.workspace}</div>
          </div>
        </div>
      </aside>

      <div className="aros-main2">
        <header className="aros-topbar">
          <span className="aros-topbar__title">{SECTION_TITLES[section]}</span>
          {section === 'chat' && <span className="aros-topbar__pill">Shre · Local</span>}
          <span className="aros-topbar__status">
            <span className="aros-health__dot" style={{ background: 'var(--ok)' }} /> 5 stores live
          </span>
          <button className="aros-topbar__toggle" onClick={toggleTheme}>{themeLabel}</button>
        </header>
        {section === 'chat' ? <ConciergeChat /> : <SectionPanel section={section} />}
      </div>
    </div>
  );
}
