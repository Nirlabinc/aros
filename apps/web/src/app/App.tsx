import { useEffect } from 'react';
import { WhitelabelProvider } from '../whitelabel/WhitelabelProvider';
import { AuthProvider, useAuth as useSupabaseAuth, type Tenant } from '../contexts/AuthContext';
import { CanvasProvider } from '../aros-ai/CanvasContext';
import { Shell } from '../components/Shell';
import { Dashboard } from '../components/Dashboard';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { OnboardingPage } from '../pages/onboarding/OnboardingPage';
import { JourneyPage } from '../pages/onboarding/JourneyPage';
import { MarketplacePage } from '../pages/marketplace/MarketplacePage';
import { DeveloperPortal } from '../pages/developers/DeveloperPortal';
import { LandingPage } from '../pages/landing/LandingPage';
import { SocialTemplates } from '../pages/social/SocialTemplates';
import { ContactPage } from '../pages/contact/ContactPage';
import { CostsPage } from '../pages/costs/CostsPage';
import { BillingPage } from '../pages/billing/BillingPage';
import { ChatWidget } from '../components/ChatWidget';
import { Login } from '../pages/Login';
import { Signup } from '../pages/Signup';
import { StartChat } from '../pages/start/StartChat';
import { ConnectStorePage } from '../pages/connect/ConnectStorePage';
import { ConnectStoreBanner } from '../components/ConnectStoreBanner';
import { ResetPassword } from '../pages/ResetPassword';
import { AcceptInvite } from '../pages/AcceptInvite';
import { PlatformConsole } from '../pages/PlatformConsole';
import { VerifyEmail } from '../pages/VerifyEmail';
import { ConnectionsHub } from '../pages/settings/ConnectionsHub';
import { AdministrationPage } from '../pages/settings/AdministrationPage';
import AIModelsSettings from '../pages/settings/AIModels';
import { CapabilityCatalog } from '../pages/settings/CapabilityCatalog';
import { ConnectionHealth } from '../pages/settings/ConnectionHealth';
import { DevicesPage } from '../redesign/pages/admin';
import { centralIdentityOnly } from '../lib/supabase';
import { AppShell } from '../redesign/AppShell';
import { LegalPage } from '../pages/legal/LegalPage';
import { resolveAuthenticatedLanding } from '../onboarding/journey';

const MARKETPLACE_ADMIN_URL = (window as any).__MARKETPLACE_URL__
  ? `${(window as any).__MARKETPLACE_URL__}/admin`
  : window.location.hostname === 'localhost'
    ? 'http://localhost:5458/admin'
    : 'https://marketplace.nirtek.net/admin';

/** Server-side check first (tenant.onboarding_completed), localStorage as cache */
function isOnboardingComplete(tenant: Tenant | null): boolean {
  if (tenant?.onboarding_completed) return true;
  return localStorage.getItem('aros-onboarding-complete') === 'true'
    || sessionStorage.getItem('aros-onboarding-complete') === 'true';
}

// Every route the SPA actually serves — anything else is honestly a 404 for
// signed-out visitors instead of a silent bounce to /login (sweep finding).
const KNOWN_PREFIXES = ['/login', '/auth', '/signup', '/reset-password', '/verify-email', '/legal', '/social', '/contact', '/start', '/connect', '/onboarding', '/platform', '/dashboard', '/developers', '/submit-plugin', '/billing', '/costs', '/marketplace', '/human', '/admin', '/stores', '/apps', '/skills', '/agents', '/models', '/computers', '/connection-health', '/settings', '/permissions', '/documents', '/edi-invoices', '/profile', '/users', '/workspace', '/team', '/usage', '/notifications', '/channels', '/oauth', '/preview'];

/** Tab titles per route — every page shared one static title before (sweep). */
const ROUTE_TITLES: Array<[string, string]> = [
  ['/login', 'Sign in — AROS'], ['/signup', 'Sign up — AROS'], ['/reset-password', 'Reset password — AROS'],
  ['/verify-email', 'Verify email — AROS'], ['/legal/terms', 'Terms of Service — AROS'], ['/legal/privacy', 'Privacy Policy — AROS'],
  ['/contact', 'Contact — AROS'], ['/start', 'Get started — AROS'], ['/connect', 'Connect your store — AROS'],
  ['/onboarding', 'Setup — AROS'], ['/platform', 'Platform console — AROS'], ['/dashboard', 'Home — AROS'],
  ['/stores', 'Stores — AROS'], ['/team', 'Team — AROS'], ['/users', 'Team — AROS'], ['/billing', 'Billing — AROS'],
  ['/usage', 'Usage — AROS'], ['/costs', 'Usage — AROS'], ['/notifications', 'Notifications — AROS'], ['/settings', 'Settings — AROS'], ['/marketplace', 'Apps — AROS'],
  ['/developers', 'Developers — AROS'], ['/auth/accept', 'Accept invite — AROS'],
];

function NotFoundPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif', color: '#6b7280', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#1a1a2e', marginBottom: 8 }}>AROS</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#1a1a2e', marginBottom: 6 }}>Page not found</div>
        <p style={{ fontSize: 14, lineHeight: 1.5 }}>The page you're looking for doesn't exist or has moved.</p>
        <a href="/" style={{ color: '#2563eb', fontSize: 14 }}>Back to the home page</a>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, session, tenant, loading, membershipError, onboardingStep, onboardingLoading } = useSupabaseAuth();
  const path = window.location.pathname;
  useEffect(() => {
    const match = ROUTE_TITLES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
    if (match) document.title = match[1];
  }, [path]);
  const isAdmin = user?.app_metadata?.role === 'admin' || user?.app_metadata?.role === 'superadmin';
  const onboarded = isOnboardingComplete(tenant);
  // Single source of truth for where an authenticated session lands (see
  // onboarding/journey.ts): onboarded workspaces always resolve to /dashboard
  // via the backend tenant flag (works on a new device with empty caches), a
  // membership-lookup failure never restarts onboarding, genuinely new
  // workspaces get /start, and a mid-journey workspace resumes at /onboarding.
  // We only need the resumable progress step for the not-yet-onboarded case, so
  // fold its loading into the gate to avoid flashing /start at a returning user.
  const needsProgress = !!session && !!tenant && !onboarded && !membershipError && !centralIdentityOnly;
  const authenticatedLanding = resolveAuthenticatedLanding({
    loading: loading || (needsProgress && onboardingLoading),
    hasSession: !!session,
    onboardingCompleted: onboarded,
    membershipError: !!membershipError,
    progressStep: onboardingStep,
  });

  // Chat-first redesign preview — self-contained, no auth, for review only.
  if (path.startsWith('/preview/app')) {
    return <AppShell />;
  }

  // The chat-first shell is now the authenticated default. Keep a reversible
  // per-browser escape hatch while the legacy shell is still in the bundle.
  const redesignParam = new URLSearchParams(window.location.search).get('redesign');
  if (redesignParam === '1') { try { localStorage.removeItem('aros-shell-legacy'); } catch { /* ignore */ } }
  else if (redesignParam === '0') { try { localStorage.setItem('aros-shell-legacy', '1'); } catch { /* ignore */ } }

  if (centralIdentityOnly && !loading && !session && path !== '/login' && path !== '/signup') {
    const authorize = path === '/oauth/authorize' ? `${path}${window.location.search}` : null;
    window.location.replace(authorize ? `/login?return_to=${encodeURIComponent(authorize)}` : '/login');
    return null;
  }

  // ── Public auth pages (no session required) ────────────────
  if (path === '/login' || path === '/auth') {
    const isHostedResume = new URLSearchParams(window.location.search).has('return_to');
    if (session && !loading && !isHostedResume && authenticatedLanding) {
      // New users land in the value-first demo chat (/start), not the wizard;
      // returning/mid-journey users resolve to /dashboard or /onboarding.
      window.location.href = authenticatedLanding;
      return null;
    }
    return <><Login /><ChatWidget /></>;
  }

  if (path === '/signup') {
    if (session && !loading && authenticatedLanding) {
      window.location.href = authenticatedLanding;
      return null;
    }
    return <><Signup /><ChatWidget /></>;
  }

  if (path === '/reset-password') {
    return <ResetPassword />;
  }

  // Invite-email landing: must render for signed-out visitors — the page
  // itself waits for supabase-js to consume the invite tokens from the hash.
  if (path === '/auth/accept') {
    return <AcceptInvite />;
  }

  // Founder-only platform console; the server allow-list is the real gate —
  // for everyone else this renders the same "not available" shell.
  if (path === '/platform') {
    return <PlatformConsole />;
  }

  if (path === '/verify-email') {
    return <VerifyEmail />;
  }

  // Legal pages — public, no auth required. Placeholder outlines pending
  // attorney review (see pages/legal/LegalPage.tsx).
  if (path === '/legal/terms') {
    return <LegalPage kind="terms" />;
  }
  if (path === '/legal/privacy') {
    return <LegalPage kind="privacy" />;
  }

  // Social media templates — internal operator tooling (contains marketing
  // production instructions), never for anonymous visitors (sweep finding).
  if (path === '/social') {
    if (!loading && !session) { window.location.replace('/login?returnTo=%2Fsocial'); return null; }
    return <SocialTemplates />;
  }

  // Contact page — public, no auth required
  if (path === '/contact') {
    return <><ContactPage /><ChatWidget /></>;
  }

  // Landing page at root — show immediately (no auth wait needed for public page)
  if (path === '/' && !session) {
    return <><LandingPage /><ChatWidget /></>;
  }

  // Honest 404 for signed-out visitors on unknown routes.
  if (!session && !loading && path !== '/' && !KNOWN_PREFIXES.some(p => path === p || path.startsWith(`${p}/`))) {
    return <NotFoundPage />;
  }

  // ── Loading state for auth-required pages ──────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Inter, system-ui, sans-serif', color: '#6b7280' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#1a1a2e', marginBottom: 8 }}>AROS</div>
          <div style={{ fontSize: 14 }}>Loading...</div>
        </div>
      </div>
    );
  }

  // ── Auth-required pages ────────────────────────────────────

  // Start — value-first demo chat, the day-one landing surface (full-screen).
  // Reachable by new users right after signup; requires auth but NOT onboarding.
  if (path.startsWith('/start')) {
    return (
      <ProtectedRoute>
        <StartChat />
      </ProtectedRoute>
    );
  }

  // Connect store — the real "connect your store" step. Reachable both before
  // onboarding (from /start, full-screen) and after (from the sidebar/banner).
  // Exact-or-subpath match ONLY: a bare startsWith('/connect') also swallowed
  // /connection-health, so full page-loads of the health page rendered the
  // connect wizard (validation-sweep flake, deterministic on hard loads).
  if (path === '/connect' || path.startsWith('/connect/')) {
    return (
      <ProtectedRoute>
        <ConnectStorePage onboarded={onboarded} />
      </ProtectedRoute>
    );
  }

  // Onboarding — the resumable journey (model → connect → readiness). The legacy
  // plan/business wizard is retained only for the Stripe payment round-trip so
  // in-flight checkouts still complete.
  if (path.startsWith('/onboarding')) {
    const isPaymentCallback = new URLSearchParams(window.location.search).has('payment');
    return (
      <ProtectedRoute>
        {isPaymentCallback ? <OnboardingPage /> : <JourneyPage />}
      </ProtectedRoute>
    );
  }

  // All remaining routes require auth + onboarding complete
  return (
    <ProtectedRoute>
      <AuthenticatedRoutes path={path} isAdmin={isAdmin} onboarded={onboarded} landing={authenticatedLanding} />
    </ProtectedRoute>
  );
}

function AuthenticatedRoutes({ path, isAdmin, onboarded, landing }: { path: string; isAdmin: boolean; onboarded: boolean; landing: string | null }) {
  // Gate: a not-yet-onboarded workspace resumes at the right place — /start for
  // a genuinely new one, /onboarding for a mid-journey one (see journey.ts). The
  // payment callback still resumes the legacy wizard so Stripe round-trips work.
  if (!onboarded) {
    const params = new URLSearchParams(window.location.search);
    if (params.has('payment')) {
      return <OnboardingPage />;
    }
    if (!landing) return null; // progress still resolving — avoid a premature redirect
    window.location.href = landing;
    return null;
  }

  // New themed shell is the default for every onboarded authenticated route.
  // `?redesign=0` temporarily restores the legacy UI on this browser.
  let legacyShell = false;
  try { legacyShell = localStorage.getItem('aros-shell-legacy') === '1'; } catch { /* ignore */ }
  // Routes the new shell has no pane for must be matched BEFORE the shell
  // catch-all — /developers previously fell through and silently rendered
  // Home (validation sweep finding).
  if (!legacyShell && (path.startsWith('/developers') || path.startsWith('/submit-plugin'))) {
    return <Shell><DeveloperPortal /></Shell>;
  }
  if (!legacyShell) return <AppShell />;

  // Admin panel -> marketplace admin
  if (path.startsWith('/admin') && isAdmin) {
    window.location.href = MARKETPLACE_ADMIN_URL;
    return null;
  }

  // Developers portal
  if (path.startsWith('/developers') || path.startsWith('/submit-plugin')) {
    return <Shell><DeveloperPortal /></Shell>;
  }

  // Billing
  if (path.startsWith('/billing')) {
    return <Shell><BillingPage /></Shell>;
  }

  // Costs
  if (path.startsWith('/costs')) {
    return <Shell><CostsPage /></Shell>;
  }

  const setupRoute = path.startsWith('/stores') ? <ConnectionsHub kind="pos" />
    : path.startsWith('/apps') ? <ConnectionsHub kind="app" />
    : path.startsWith('/channels') ? <CapabilityCatalog kind="channels" />
    : path.startsWith('/agents') ? <CapabilityCatalog kind="agents" />
    : path.startsWith('/skills') ? <CapabilityCatalog kind="skills" />
    : path.startsWith('/models') ? <AIModelsSettings />
    : path.startsWith('/computers') ? <DevicesPage />
    : path.startsWith('/connection-health') ? <ConnectionHealth />
    : path.startsWith('/settings') ? <AdministrationPage section="settings" />
    : path.startsWith('/profile') ? <AdministrationPage section="profile" />
    : path.startsWith('/users') ? <AdministrationPage section="users" />
    : path.startsWith('/workspace') ? <AdministrationPage section="workspace" />
    : null;
  if (setupRoute) return <Shell>{setupRoute}</Shell>;

  // Marketplace
  if (path.startsWith('/marketplace')) {
    return <Shell><MarketplacePage /></Shell>;
  }

  // Dashboard (default for logged-in users)
  if (path.startsWith('/human')) {
    return <Shell><Dashboard /></Shell>;
  }

  return (
    <Shell>
      <ConnectStoreBanner />
      <Dashboard />
    </Shell>
  );
}

export function App() {
  return (
    <WhitelabelProvider>
      <AuthProvider>
        <CanvasProvider>
          <AppContent />
        </CanvasProvider>
      </AuthProvider>
    </WhitelabelProvider>
  );
}
