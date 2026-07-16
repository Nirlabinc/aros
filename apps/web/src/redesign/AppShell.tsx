import { useState, useEffect } from 'react';
import { useArosTheme } from '../lib/useArosTheme';
import { ConciergeChat } from './ConciergeChat';
import { SectionPanel } from './SectionPanel';
import { ConnectWizard } from './ConnectWizard';
import { Canvas } from './Canvas';
import {
  PRIMARY_NAV, WORKSPACE_NAV, USER, ROLES, SECTION_TITLES, type SectionKey, type NavItem,
} from './shellData';

const ChatIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
);
const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
);
const PlusIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);

function NavRow({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button className="rsx-nav" aria-current={active} onClick={onClick}>
      <span className="rsx-nav__glyph">{item.glyph}</span>
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.count != null && <span className="rsx-nav__count">{item.count}</span>}
    </button>
  );
}

/**
 * Chat-first shell (v2, Claude-design layout). Two modes:
 *  - chat: chat pane (left) + conversation canvas (right).
 *  - app:  section nav (left) + section content (right), opened from the top menu.
 * Role + workspace menus live in a slide-in profile sidebar (opened from the
 * profile button), not the main rail.
 */
export function AppShell() {
  const [mode, setMode] = useState<'chat' | 'app'>('chat');
  const [section, setSection] = useState<SectionKey>('stores');
  const [role, setRole] = useState<string>(USER.role);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const { label: themeLabel, toggle: toggleTheme } = useArosTheme();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const openWizard = () => setWizardOpen(true);
  const goSection = (key: SectionKey) => {
    setMenuOpen(false); setProfileOpen(false);
    if (key === 'chat') { setMode('chat'); return; }
    setSection(key); setMode('app');
  };
  const title = mode === 'chat' ? 'Concierge' : SECTION_TITLES[section];

  return (
    <div className="rsx2-shell">
      <header className="rsx2-top">
        <button className={`rsx2-icon ${mode === 'chat' ? 'is-on' : ''}`} onClick={() => setMode('chat')} aria-label="Chat" title="Chat"><ChatIcon /></button>
        <div className="rsx2-top__menu">
          <button className={`rsx2-icon ${menuOpen ? 'is-on' : ''}`} onClick={() => setMenuOpen(o => !o)} aria-label="Menu" title="Menu"><MenuIcon /></button>
          {menuOpen && (
            <div className="rsx2-dropdown">
              {PRIMARY_NAV.map(item => (
                <button key={item.key} className="rsx2-dropdown__item" onClick={() => goSection(item.key)}>
                  <span className="rsx-nav__glyph">{item.glyph}</span>{item.label}
                  {item.count != null && <span className="rsx-nav__count" style={{ marginLeft: 'auto' }}>{item.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="rsx2-brand"><div className="aros-side__mark">A</div><span className="rsx2-top__title">{title}</span></div>
        {mode === 'chat' && <span className="aros-topbar__pill">Shre · Local</span>}
        <div style={{ flex: 1 }} />
        <span className="aros-topbar__status"><span className="aros-health__dot" style={{ background: 'var(--ok)' }} /> 5 stores live</span>
        <button className="aros-topbar__toggle" onClick={toggleTheme}>{themeLabel}</button>
        <button className="rsx2-avatar" onClick={() => setProfileOpen(true)} aria-label="Profile" title="Profile">{USER.initials}</button>
      </header>

      <div className="rsx2-body">
        {mode === 'chat' ? (
          <>
            <div className="rsx2-chatpane">
              <div className="rsx2-chatpane__head">
                <span className="rsx2-chatpane__label">Concierge</span>
                <button className="rsx2-chatpane__new" onClick={() => setChatKey(k => k + 1)}><PlusIcon /> New chat</button>
              </div>
              <ConciergeChat key={chatKey} onConnect={openWizard} />
            </div>
            <Canvas />
          </>
        ) : (
          <>
            <aside className="rsx2-nav">
              {PRIMARY_NAV.map(item => (
                <NavRow key={item.key} item={item} active={section === item.key} onClick={() => goSection(item.key)} />
              ))}
            </aside>
            <div className="rsx2-content"><SectionPanel section={section as Exclude<SectionKey, 'chat'>} onConnect={openWizard} /></div>
          </>
        )}
      </div>

      {profileOpen && (
        <div className="rsx2-scrim" onClick={() => setProfileOpen(false)}>
          <aside className="rsx2-profile" onClick={e => e.stopPropagation()}>
            <div className="rsx2-profile__head">
              <div className="aros-user__avatar" style={{ width: 40, height: 40, fontSize: 14 }}>{USER.initials}</div>
              <div>
                <div className="aros-user__name" style={{ fontSize: 15 }}>{USER.name}</div>
                <div className="aros-user__meta">{role} · {USER.workspace}</div>
              </div>
              <button className="rsx-modal__x" style={{ marginLeft: 'auto' }} onClick={() => setProfileOpen(false)} aria-label="Close">×</button>
            </div>

            <div className="aros-role__label" style={{ marginTop: 8 }}>Role</div>
            <div className="aros-role__pills">
              {ROLES.map(r => (
                <button key={r} className="aros-role__pill" aria-pressed={role === r} onClick={() => setRole(r)}>{r}</button>
              ))}
            </div>

            <div className="aros-side__section" style={{ marginLeft: 0 }}>Workspace</div>
            <nav>
              {WORKSPACE_NAV.map(item => (
                <NavRow key={item.key} item={item} active={mode === 'app' && section === item.key} onClick={() => goSection(item.key)} />
              ))}
            </nav>

            <div style={{ flex: 1 }} />
            <button className="rsx2-signout">Sign out</button>
          </aside>
        </div>
      )}

      {wizardOpen && (
        <ConnectWizard
          onClose={() => setWizardOpen(false)}
          onDone={name => { setWizardOpen(false); setToast(`${name} connected — discovering stores…`); }}
        />
      )}
      {toast && <div className="rsx-toast">✓ {toast}</div>}
    </div>
  );
}
