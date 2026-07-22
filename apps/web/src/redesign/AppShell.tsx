import { useState, useEffect, useRef } from 'react';
import { useArosTheme } from '../lib/useArosTheme';
import { ConciergeChat } from './ConciergeChat';
import { SectionPanel } from './SectionPanel';
import { IntelligencePage } from './pages/intelligence';
import { StoresPage, AppsPage, MarketplacePage, ConnectorsPage, PluginsPage } from './pages/connections';
import { listMarketplaceEntitlements } from './pages/connections/api';
import {
  BillingPage, UsagePage, TeamPage, SettingsPage, PermissionsPage, ProfilePage, ConnectionHealthPage, DevicesPage,
} from './pages/admin';
import { NotificationsPage } from './pages/admin/NotificationsPage';
import { DocumentsPage } from './pages/Documents';
import { EdiInvoices } from './pages/EdiInvoices';
import { ConnectWizard } from './ConnectWizard';
import { Canvas } from './Canvas';
import { Home } from './Home';
import { HistoryPanel } from './HistoryPanel';
import { branding } from './branding';
import { type CanvasWidgetItem } from '../aros-ai/canvas';
import { useConnectionSummary, useDemo, useIdentity } from './data';
import { useAuth } from '../contexts/AuthContext';
import {
  PRIMARY_NAV, WORKSPACE_NAV, EMBEDDED_APP_NAV, USER, ROLES, SECTION_TITLES, type SectionKey, type NavItem, type ChatMsg, type Conversation,
} from './shellData';
import { routeState, SECTION_TO_PATH } from './routes';
import { DeveloperPortal } from '../pages/developers/DeveloperPortal';

const ChatIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>);
const MenuIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>);
const PlusIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);
const API_BASE = (window as any).__AROS_API_URL__ || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

const routeStateHere = () => routeState(window.location.pathname);

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

function AppInstallPrompt({ name, onBrowse }: { name: string; onBrowse: () => void }) {
  return (
    <div className="rsx-panel">
      <div className="rsx2-empty">
        <div className="rsx2-empty__title">{name} isn’t installed in this workspace</div>
        <div className="rsx2-empty__text">{name} is available as an app in the Marketplace. An owner or admin can install it to turn it on for everyone in the workspace.</div>
        <button className="rsx-panel__cta" type="button" onClick={onBrowse}>Install from Marketplace</button>
      </div>
    </div>
  );
}

export function AppShell() {
  const { signOut, session, tenant } = useAuth();
  const b = branding();
  const ident = useIdentity();
  const demo = useDemo();
  const connections = useConnectionSummary();
  const initialRoute = routeStateHere();
  const [mode, setMode] = useState<'home' | 'chat' | 'app'>(initialRoute.mode);
  const [section, setSection] = useState<Exclude<SectionKey, 'chat'>>(initialRoute.section);
  const role = demo ? USER.role : ident.role;
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const [seed, setSeed] = useState('');
  const [rightTab, setRightTab] = useState<'canvas' | 'history'>('canvas');
  const [recalled, setRecalled] = useState<ChatMsg[] | null>(null);
  const [activeConvo, setActiveConvo] = useState<string | undefined>(undefined);
  const [canvasItems, setCanvasItems] = useState<CanvasWidgetItem[]>([]);
  const { label: themeLabel, toggle: toggleTheme } = useArosTheme();
  const chatToggleRef = useRef<HTMLButtonElement>(null);

  // Active marketplace entitlements drive which in-shell apps (Documents,
  // EDI Invoices) are routable and appear in the workspace nav. null = loading.
  // Demo/preview treats every embedded app as installed.
  const [installedApps, setInstalledApps] = useState<Set<string> | null>(demo ? new Set(Object.keys(EMBEDDED_APP_NAV)) : null);
  const refreshInstalledApps = () => {
    if (demo) { setInstalledApps(new Set(Object.keys(EMBEDDED_APP_NAV))); return; }
    listMarketplaceEntitlements({ accessToken: session?.access_token, tenantId: tenant?.id })
      .then(grants => setInstalledApps(new Set(grants.filter(g => g.status === 'active').map(g => g.app_key))))
      .catch(() => setInstalledApps(new Set()));
  };
  useEffect(() => {
    refreshInstalledApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, session?.access_token, tenant?.id]);
  const installedAppNav: NavItem[] = (Object.keys(EMBEDDED_APP_NAV) as Array<keyof typeof EMBEDDED_APP_NAV>)
    .filter(key => installedApps?.has(key))
    .map(key => EMBEDDED_APP_NAV[key]);

  const navigate = (nextMode: 'home' | 'chat' | 'app', nextSection?: Exclude<SectionKey, 'chat'>) => {
    const path = nextMode === 'home' ? '/dashboard' : nextMode === 'chat' ? '/chat' : SECTION_TO_PATH[nextSection ?? section] ?? '/dashboard';
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    if (nextSection) setSection(nextSection);
    setMode(nextMode);
  };

  useEffect(() => {
    const onPopState = () => { const next = routeStateHere(); setMode(next.mode); setSection(next.section); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const recall = (c: Conversation) => { setRecalled(c.messages); setActiveConvo(c.id); setCanvasItems([]); setChatKey(k => k + 1); setRightTab('canvas'); setMode('chat'); };
  const newChat = () => { setRecalled(null); setActiveConvo(undefined); setCanvasItems([]); setSeed(''); setChatKey(k => k + 1); };
  const onCanvasItems = (items: CanvasWidgetItem[]) => { setCanvasItems(items); if (items.length) setRightTab('canvas'); };
  // Menu: on mobile (no docked sidebar) open the nav drawer; on desktop close
  // chat and return to Home, where the docked sidebar is always visible.
  const onMenu = () => {
    const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches;
    if (mobile) setMenuOpen(true);
    else { navigate('home'); setMenuOpen(false); }
  };
  // Profile is a LEFT panel overlapping the sidebar; it persists while you click
  // through the account pages (Home + Team/Billing/Usage/Settings).
  const openProfile = () => { if (mode === 'chat') setMode('home'); setMenuOpen(false); setProfileOpen(true); };
  const goProfileSection = (key: SectionKey) => { if (key !== 'chat') navigate('app', key); };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const openWizard = () => setWizardOpen(true);
  const askShre = (q?: string) => { setSeed(q || ''); navigate('chat'); };
  const toggleChat = () => navigate(mode === 'chat' ? 'home' : 'chat');
  const goSection = (key: SectionKey) => {
    setMenuOpen(false); setProfileOpen(false);
    if (key === 'chat') { navigate('chat'); return; }
    navigate('app', key);
  };
  const switchToMib = async () => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      if (tenant?.id) headers['x-aros-tenant-id'] = tenant.id;
      const res = await fetch(`${API_BASE}/auth/experience-preference`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ preferredExperience: 'mib' }),
      });
      const data = await res.json();
      if (!res.ok || !data.targetUrl) throw new Error(data.error || 'MIB is not available for this workspace.');
      window.location.assign(data.targetUrl);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'MIB is not available for this workspace.');
    }
  };
  const title = mode === 'chat' ? 'Concierge' : mode === 'home' ? 'Home' : SECTION_TITLES[section];
  const renderSection = () => {
    // In-shell marketplace apps gate on an active entitlement: not installed →
    // an install prompt pointing at Marketplace, never a broken page.
    if (section === 'documents' || section === 'edi-invoices') {
      if (installedApps === null) return <div className="rsx-panel"><div className="rsx2-empty"><div className="rsx2-empty__title">Loading…</div></div></div>;
      if (!installedApps.has(section)) {
        return <AppInstallPrompt name={EMBEDDED_APP_NAV[section].label} onBrowse={() => goSection('marketplace')} />;
      }
      if (section === 'documents') return <DocumentsPage />;
      return demo ? <SectionPanel section={section} onConnect={openWizard} /> : <EdiInvoices />;
    }
    if (demo) return <SectionPanel section={section} onConnect={openWizard} />;
    if (section === 'marketplace') return <MarketplacePage onChange={refreshInstalledApps} />;
    if (section === 'connectors') return <ConnectorsPage onBrowse={() => goSection('marketplace')} />;
    if (section === 'plugins') return <PluginsPage onBrowse={() => goSection('marketplace')} />;
    if (section === 'stores') return <StoresPage onConnect={openWizard} />;
    if (section === 'apps') return <AppsPage onBrowse={() => goSection('marketplace')} />;
    if (section === 'permissions') return <PermissionsPage />;
    if (section === 'health') return <ConnectionHealthPage />;
    if (section === 'devices') return <DevicesPage />;
    if (section === 'team') return <TeamPage />;
    if (section === 'billing') return <BillingPage />;
    if (section === 'usage') return <UsagePage />;
    if (section === 'settings') return <SettingsPage />;
    if (section === 'profile') return <ProfilePage />;
    if (section === 'developers') return <DeveloperPortal />;
    if (section === 'notifications') return <NotificationsPage />;
    if (section === 'skills' || section === 'agents' || section === 'models') {
      const kind = section === 'skills' ? 'skill' : section === 'agents' ? 'agent' : 'model';
      return <IntelligencePage kind={kind} />;
    }
    return <SectionPanel section={section} onConnect={openWizard} />;
  };

  return (
    <div className="rsx2-shell" data-chat={mode === 'chat' ? 'open' : 'closed'} data-mode={mode}>
      <header className="rsx2-top">
        <button ref={chatToggleRef} className={`rsx2-icon ${mode === 'chat' ? 'is-on' : ''}`} onClick={toggleChat} aria-label="Chat" aria-expanded={mode === 'chat'} title="Chat"><ChatIcon /></button>
        <button className={`rsx2-icon ${menuOpen ? 'is-on' : ''}`} onClick={onMenu} aria-label="Menu" aria-expanded={menuOpen} title="Menu"><MenuIcon /></button>
        <button className="rsx2-brand" onClick={() => navigate('home')} title="Home">
          <span className="aros-side__mark">{b.mark}</span><span className="rsx2-top__title">{title}</span>
        </button>
        {mode === 'chat' && <span className="aros-topbar__pill">{b.concierge} · Local</span>}
        <div style={{ flex: 1 }} />
        <span className="aros-topbar__status rsx2-hide-sm"><span className="aros-health__dot" style={{ background: connections.healthy > 0 ? 'var(--ok)' : 'var(--ink-3)' }} /> {connections.loading ? 'Checking connections…' : connections.total === 0 ? 'No stores connected' : `${connections.healthy}/${connections.total} connections healthy`}</span>
        <button className="aros-topbar__toggle rsx2-hide-sm" onClick={toggleTheme}>{themeLabel}</button>
        <button className="rsx2-avatar" onClick={openProfile} aria-label="Profile" title="Profile">{ident.initials}</button>
      </header>

      {mode === 'chat' ? (
        // Chat layer — the one exception: the chat rail replaces the sidebar,
        // Canvas / History tabs on the right.
        <div className="rsx2-chatlayout">
          <aside className="rsx2-chatrail">
            <div className="rsx2-chatpane__head">
              <div className="rsx2-model"><span className="rsx2-model__btn">Shre · Local</span></div>
              <button className="rsx2-chatpane__new" onClick={newChat}><PlusIcon /> New chat</button>
            </div>
            <ConciergeChat key={chatKey} onConnect={openWizard} onConnectApps={() => goSection('apps')} seed={seed} focusOnMount initial={recalled ?? undefined} onCanvasItems={onCanvasItems} />
          </aside>
          <div className="rsx2-canvaswrap">
            <div className="rsx2-tabs">
              <button className={`rsx2-tab ${rightTab === 'canvas' ? 'is-on' : ''}`} onClick={() => setRightTab('canvas')}>Canvas</button>
              <button className={`rsx2-tab ${rightTab === 'history' ? 'is-on' : ''}`} onClick={() => setRightTab('history')}>History</button>
            </div>
            {rightTab === 'canvas' ? <Canvas items={canvasItems} /> : <HistoryPanel onRecall={recall} activeId={activeConvo} />}
          </div>
        </div>
      ) : (
        // Every non-chat page: consistent docked sidebar + content.
        <div className="rsx2-appbody">
          <aside className="rsx2-nav rsx2-nav--docked">
            <div className="rsx2-nav__list">
              <button className="rsx-nav" aria-current={mode === 'home'} onClick={() => navigate('home')}>
                <span className="rsx-nav__glyph">⌂</span><span style={{ flex: 1 }}>Home</span>
              </button>
              <button className="rsx-nav" onClick={() => navigate('chat')}>
                <span className="rsx-nav__glyph">C</span><span style={{ flex: 1 }}>Chat</span>
              </button>
              {PRIMARY_NAV.filter(i => i.key !== 'chat').map(item => (
                <NavRow key={item.key} item={demo ? item : { ...item, count: undefined }} active={mode === 'app' && section === item.key} onClick={() => goSection(item.key)} />
              ))}
            </div>
            <div className="rsx2-nav__foot"><UserRow onClick={openProfile} /></div>
          </aside>
          <main className="rsx2-content">
            {mode === 'home'
              ? <Home onAskShre={askShre} onConnect={openWizard} onSection={goSection} />
              : renderSection()}
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
              <button className="rsx-nav" aria-current={mode === 'home'} onClick={() => { navigate('home'); setMenuOpen(false); }}>
                <span className="rsx-nav__glyph">⌂</span><span style={{ flex: 1 }}>Home</span>
              </button>
              <button className="rsx-nav" aria-current={mode === 'chat'} onClick={() => goSection('chat')}>
                <span className="rsx-nav__glyph">C</span><span style={{ flex: 1 }}>Chat</span>
              </button>
              {PRIMARY_NAV.filter(i => i.key !== 'chat').map(item => (
                <NavRow key={item.key} item={demo ? item : { ...item, count: undefined }} active={mode === 'app' && section === item.key} onClick={() => goSection(item.key)} />
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
            <button className="rsx-nav" aria-current={mode === 'home'} onClick={() => navigate('home')}>
              <span className="rsx-nav__glyph">⌂</span><span style={{ flex: 1 }}>Home</span>
            </button>
            <div className="aros-role__label" style={{ marginTop: 14 }}>Role</div>
            <div className="aros-role__pills">
              {demo ? ROLES.map(r => (<span key={r} className="aros-role__pill" aria-pressed={role === r}>{r}</span>)) : <span className="aros-role__pill" aria-pressed>{role}</span>}
            </div>
            <div className="aros-side__section" style={{ marginLeft: 0 }}>Account</div>
            <NavRow item={{ key: 'profile', label: 'Profile', glyph: 'Pr' }} active={mode === 'app' && section === 'profile'} onClick={() => goProfileSection('profile')} />
            <NavRow item={{ key: 'devices', label: 'Sessions & Devices', glyph: 'PC' }} active={mode === 'app' && section === 'devices'} onClick={() => goProfileSection('devices')} />
            <div className="aros-side__section" style={{ marginLeft: 0 }}>Workspace</div>
            {[...installedAppNav, ...WORKSPACE_NAV].map(item => (
              <NavRow key={item.key} item={item} active={mode === 'app' && section === item.key} onClick={() => goProfileSection(item.key)} />
            ))}
          </div>
          <div className="rsx2-nav__foot">
            <button className="rsx2-signout" style={{ width: '100%', marginBottom: 8 }} onClick={() => void switchToMib()}>Open MIB</button>
            <button className="aros-topbar__toggle rsx2-show-sm" onClick={toggleTheme} style={{ width: '100%', marginBottom: 8 }}>{themeLabel} mode</button>
            <button className="rsx2-signout" style={{ width: '100%' }} onClick={() => void signOut()}>Sign out</button>
          </div>
        </aside>
      )}

      {wizardOpen && (
        <ConnectWizard onClose={() => setWizardOpen(false)} onDone={outcome => {
          setWizardOpen(false);
          setToast(outcome.status === 'connected'
            ? (outcome.found && outcome.found.transactionsToday > 0
              ? `✓ ${outcome.name} connected — we found ${outcome.found.store}: ${outcome.found.transactionsToday.toLocaleString()} transactions today.`
              : `✓ ${outcome.name} connected — syncing your data…`)
            : `${outcome.name} saved — we couldn't confirm the connection yet. Check Connectors for its status.`);
        }} />
      )}
      {toast && <div className="rsx-toast">{toast}</div>}
    </div>
  );
}
