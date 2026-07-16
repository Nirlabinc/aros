import { useState, useEffect, useRef } from 'react';
import { useArosTheme } from '../lib/useArosTheme';
import { ConciergeChat } from './ConciergeChat';
import { SectionPanel } from './SectionPanel';
import { ConnectWizard } from './ConnectWizard';
import { Canvas } from './Canvas';
import { Home } from './Home';
import { HistoryPanel } from './HistoryPanel';
import { branding } from './branding';
import { useIdentity } from './data';
import {
  PRIMARY_NAV, WORKSPACE_NAV, USER, ROLES, SECTION_TITLES, type SectionKey, type NavItem, type ChatMsg, type Conversation,
} from './shellData';

const CHAT_MODELS = ['Shre · Local', 'Anthropic Claude', 'OpenAI GPT-4o', 'Google Gemini'];

const ChatIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>);
const MenuIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>);
const PlusIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);

function NavRow({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button className="rsx-nav" aria-current={active} onClick={onClick}>
      <span className="rsx-nav__glyph">{item.glyph}</span>
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.count != null && <span className="rsx-nav__count">{item.count}</span>}
    </button>
  );
}

function UserRow({ onClick }: { onClick: () => void }) {
  const id = useIdentity();
  return (
    <button className="rsx2-userrow" onClick={onClick}>
      <span className="aros-user__avatar">{id.initials}</span>
      <span className="rsx2-userrow__info">
        <span className="aros-user__name">{id.name}</span>
        <span className="aros-user__meta">{id.role} · {id.workspace}</span>
      </span>
    </button>
  );
}

export function AppShell() {
  const b = branding();
  const ident = useIdentity();
  const [mode, setMode] = useState<'home' | 'chat' | 'app'>('home');
  const [section, setSection] = useState<Exclude<SectionKey, 'chat'>>('stores');
  const [role, setRole] = useState<string>(USER.role);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState(CHAT_MODELS[0]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const [seed, setSeed] = useState('');
  const [rightTab, setRightTab] = useState<'canvas' | 'history'>('canvas');
  const [recalled, setRecalled] = useState<ChatMsg[] | null>(null);
  const [activeConvo, setActiveConvo] = useState<string | undefined>(undefined);
  const [canvasBlocks, setCanvasBlocks] = useState<any[] | null>(null);
  const { label: themeLabel, toggle: toggleTheme } = useArosTheme();
  const chatToggleRef = useRef<HTMLButtonElement>(null);

  const recall = (c: Conversation) => { setRecalled(c.messages); setActiveConvo(c.id); setCanvasBlocks(null); setChatKey(k => k + 1); setRightTab('canvas'); setMode('chat'); };
  const newChat = () => { setRecalled(null); setActiveConvo(undefined); setCanvasBlocks(null); setSeed(''); setChatKey(k => k + 1); };
  const onChatReply = (data: any) => {
    const b = data?.blocks || data?.canvas?.blocks || data?.content_blocks;
    if (Array.isArray(b) && b.length) { setCanvasBlocks(b); setRightTab('canvas'); }
  };
  // Menu: on mobile (no docked sidebar) open the nav drawer; on desktop close
  // chat and return to Home, where the docked sidebar is always visible.
  const onMenu = () => {
    const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches;
    if (mobile) setMenuOpen(true);
    else { setMode('home'); setMenuOpen(false); }
  };
  // Profile is a LEFT panel overlapping the sidebar; it persists while you click
  // through the account pages (Home + Team/Billing/Usage/Settings).
  const openProfile = () => { if (mode === 'chat') setMode('home'); setMenuOpen(false); setProfileOpen(true); };
  const goProfileSection = (key: SectionKey) => { if (key !== 'chat') { setSection(key); setMode('app'); } };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const openWizard = () => setWizardOpen(true);
  const askShre = (q?: string) => { setSeed(q || ''); setMode('chat'); };
  const toggleChat = () => setMode(m => (m === 'chat' ? 'home' : 'chat'));
  const goSection = (key: SectionKey) => {
    setMenuOpen(false); setProfileOpen(false);
    if (key === 'chat') { setMode('chat'); return; }
    setSection(key); setMode('app');
  };
  const title = mode === 'chat' ? 'Concierge' : mode === 'home' ? 'Home' : SECTION_TITLES[section];

  return (
    <div className="rsx2-shell" data-chat={mode === 'chat' ? 'open' : 'closed'} data-mode={mode}>
      <header className="rsx2-top">
        <button ref={chatToggleRef} className={`rsx2-icon ${mode === 'chat' ? 'is-on' : ''}`} onClick={toggleChat} aria-label="Chat" aria-expanded={mode === 'chat'} title="Chat"><ChatIcon /></button>
        <button className={`rsx2-icon ${menuOpen ? 'is-on' : ''}`} onClick={onMenu} aria-label="Menu" aria-expanded={menuOpen} title="Menu"><MenuIcon /></button>
        <button className="rsx2-brand" onClick={() => setMode('home')} title="Home">
          <span className="aros-side__mark">{b.mark}</span><span className="rsx2-top__title">{title}</span>
        </button>
        {mode === 'chat' && <span className="aros-topbar__pill">{b.concierge} · Local</span>}
        <div style={{ flex: 1 }} />
        <span className="aros-topbar__status rsx2-hide-sm"><span className="aros-health__dot" style={{ background: 'var(--ok)' }} /> 5 stores live</span>
        <button className="aros-topbar__toggle rsx2-hide-sm" onClick={toggleTheme}>{themeLabel}</button>
        <button className="rsx2-avatar" onClick={openProfile} aria-label="Profile" title="Profile">{ident.initials}</button>
      </header>

      {mode === 'chat' ? (
        // Chat layer — the one exception: the chat rail replaces the sidebar,
        // Canvas / History tabs on the right.
        <div className="rsx2-chatlayout">
          <aside className="rsx2-chatrail">
            <div className="rsx2-chatpane__head">
              <div className="rsx2-model">
                <button className="rsx2-model__btn" onClick={() => setModelOpen(o => !o)}>{model} <span aria-hidden>▾</span></button>
                {modelOpen && (
                  <>
                    <div className="rsx2-menuscrim" onClick={() => setModelOpen(false)} />
                    <div className="rsx2-dropdown" style={{ top: 'calc(100% + 4px)' }}>
                      {CHAT_MODELS.map(m => (
                        <button key={m} className="rsx2-dropdown__item" onClick={() => { setModel(m); setModelOpen(false); }}>{m}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button className="rsx2-chatpane__new" onClick={newChat}><PlusIcon /> New chat</button>
            </div>
            <ConciergeChat key={chatKey} onConnect={openWizard} seed={seed} focusOnMount initial={recalled ?? undefined} onReply={onChatReply} />
          </aside>
          <div className="rsx2-canvaswrap">
            <div className="rsx2-tabs">
              <button className={`rsx2-tab ${rightTab === 'canvas' ? 'is-on' : ''}`} onClick={() => setRightTab('canvas')}>Canvas</button>
              <button className={`rsx2-tab ${rightTab === 'history' ? 'is-on' : ''}`} onClick={() => setRightTab('history')}>History</button>
            </div>
            {rightTab === 'canvas' ? <Canvas blocks={canvasBlocks ?? undefined} /> : <HistoryPanel onRecall={recall} activeId={activeConvo} />}
          </div>
        </div>
      ) : (
        // Every non-chat page: consistent docked sidebar + content.
        <div className="rsx2-appbody">
          <aside className="rsx2-nav rsx2-nav--docked">
            <div className="rsx2-nav__list">
              <button className="rsx-nav" aria-current={mode === 'home'} onClick={() => setMode('home')}>
                <span className="rsx-nav__glyph">⌂</span><span style={{ flex: 1 }}>Home</span>
              </button>
              <button className="rsx-nav" onClick={() => setMode('chat')}>
                <span className="rsx-nav__glyph">C</span><span style={{ flex: 1 }}>Chat</span>
              </button>
              {PRIMARY_NAV.filter(i => i.key !== 'chat').map(item => (
                <NavRow key={item.key} item={item} active={mode === 'app' && section === item.key} onClick={() => goSection(item.key)} />
              ))}
            </div>
            <div className="rsx2-nav__foot"><UserRow onClick={openProfile} /></div>
          </aside>
          <main className="rsx2-content">
            {mode === 'home'
              ? <Home onAskShre={askShre} onConnect={openWizard} onSection={goSection} />
              : <SectionPanel section={section} onConnect={openWizard} />}
          </main>
        </div>
      )}

      {menuOpen && (
        <div className="rsx2-scrim rsx2-scrim--left" onClick={() => setMenuOpen(false)}>
          <aside className="rsx2-drawer" onClick={e => e.stopPropagation()}>
            <div className="rsx2-drawer__brand">
              <span className="aros-side__mark">{b.mark}</span>
              <div><div className="aros-side__brandname">{b.product}</div><div className="aros-side__brandby">{b.byline}</div></div>
            </div>
            <div className="rsx2-nav__list">
              <button className="rsx-nav" aria-current={mode === 'home'} onClick={() => { setMode('home'); setMenuOpen(false); }}>
                <span className="rsx-nav__glyph">⌂</span><span style={{ flex: 1 }}>Home</span>
              </button>
              <button className="rsx-nav" aria-current={mode === 'chat'} onClick={() => goSection('chat')}>
                <span className="rsx-nav__glyph">C</span><span style={{ flex: 1 }}>Chat</span>
              </button>
              {PRIMARY_NAV.filter(i => i.key !== 'chat').map(item => (
                <NavRow key={item.key} item={item} active={mode === 'app' && section === item.key} onClick={() => goSection(item.key)} />
              ))}
            </div>
            <div className="rsx2-nav__foot"><UserRow onClick={openProfile} /></div>
          </aside>
        </div>
      )}

      {profileOpen && (
        <aside className="rsx2-profilenav">
          <div className="rsx2-profilenav__head">
            <div className="aros-user__avatar" style={{ width: 38, height: 38, fontSize: 13 }}>{ident.initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="aros-user__name" style={{ fontSize: 14 }}>{ident.name}</div>
              <div className="aros-user__meta">{role} · {ident.workspace}</div>
            </div>
            <button className="rsx-modal__x" onClick={() => setProfileOpen(false)} aria-label="Close profile">×</button>
          </div>
          <div className="rsx2-nav__list">
            <button className="rsx-nav" aria-current={mode === 'home'} onClick={() => setMode('home')}>
              <span className="rsx-nav__glyph">⌂</span><span style={{ flex: 1 }}>Home</span>
            </button>
            <div className="aros-role__label" style={{ marginTop: 14 }}>Role</div>
            <div className="aros-role__pills">
              {ROLES.map(r => (<button key={r} className="aros-role__pill" aria-pressed={role === r} onClick={() => setRole(r)}>{r}</button>))}
            </div>
            <div className="aros-side__section" style={{ marginLeft: 0 }}>Workspace</div>
            {WORKSPACE_NAV.map(item => (
              <NavRow key={item.key} item={item} active={mode === 'app' && section === item.key} onClick={() => goProfileSection(item.key)} />
            ))}
          </div>
          <div className="rsx2-nav__foot">
            <button className="aros-topbar__toggle rsx2-show-sm" onClick={toggleTheme} style={{ width: '100%', marginBottom: 8 }}>{themeLabel} mode</button>
            <button className="rsx2-signout" style={{ width: '100%' }}>Sign out</button>
          </div>
        </aside>
      )}

      {wizardOpen && (
        <ConnectWizard onClose={() => setWizardOpen(false)} onDone={name => { setWizardOpen(false); setToast(`${name} connected — discovering stores…`); }} />
      )}
      {toast && <div className="rsx-toast">✓ {toast}</div>}
    </div>
  );
}
