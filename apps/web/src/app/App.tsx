import { useEffect } from 'react';
import { WhitelabelProvider } from '../whitelabel/WhitelabelProvider';
import { AuthProvider, useAuth as useSupabaseAuth, type Tenant } from '../contexts/AuthContext';
import { CanvasProvider } from '../aros-ai/CanvasContext';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { OnboardingPage } from '../pages/onboarding/OnboardingPage';
import { JourneyPage } from '../pages/onboarding/JourneyPage';
import { LandingPage } from '../pages/landing/LandingPage';
import { SocialTemplates } from '../pages/social/SocialTemplates';
import { ContactPage } from '../pages/contact/ContactPage';
import { ChatWidget } from '../components/ChatWidget';
import { Login } from '../pages/Login';
import { Signup } from '../pages/Signup';
import { StartChat } from '../pages/start/StartChat';
import { ConnectStorePage } from '../pages/connect/ConnectStorePage';
import { ResetPassword } from '../pages/ResetPassword';
import { AcceptInvite } from '../pages/AcceptInvite';
import { PlatformConsole } from '../pages/PlatformConsole';
import { VerifyEmail } from '../pages/VerifyEmail';
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
const KNOWN_PREFIXES = ['/login', '/auth', '/signup', '/reset-password', '/verify-email', '/legal', '/social', '/contact', '/start', '/connect', '/onboarding', '/platform', '/dashboard', '/developers', '/submit-plugin', '/billing', '/costs', '/marketplace', '/connectors', '/plugins', '/chat', '/human', '/admin', '/stores', '/apps', '/skills', '/agents', '/models', '/computers', '/connection-health', '/settings', '/permissions', '/documents', '/edi-invoices', '/profile', '/users', '/workspace', '/team', '/usage', '/notifications', '/wallet', '/channels', '/oauth', '/preview'];

/** Tab titles per route — every page shared one static title before (sweep). */
const ROUTE_TITLES: Array<[string, string]> = [
  ['/login', 'Sign in — AROS'], ['/signup', 'Sign up — AROS'], ['/reset-password', 'Reset password — AROS'],
  ['/verify-email', 'Verify email — AROS'], ['/legal/terms', 'Terms of Service — AROS'], ['/legal/privacy', 'Privacy Policy — AROS'],
  ['/contact', 'Contact — AROS'], ['/start', 'Get started — AROS'], ['/connect', 'Connect your store — AROS'],
  ['/onboarding', 'Setup — AROS'], ['/platform', 'Platform console — AROS'], ['/dashboard', 'Home — AROS'],
  ['/stores', 'Stores — AROS'], ['/team', 'Team — AROS'], ['/users', 'Team — AROS'], ['/billing', 'Billing — AROS'],
  ['/usage', 'Usage — AROS'], ['/costs', 'Usage — AROS'], ['/notifications', 'Notifications — AROS'], ['/wallet', 'Wallet — AROS'], ['/settings', 'Settings — AROS'], ['/marketplace', 'Marketplace — AROS'], ['/apps', 'Apps — AROS'],
  ['/documents', 'Documents — AROS'], ['/edi-invoices', 'EDI Invoices — AROS'], ['/profile', 'Profile — AROS'], ['/connectors', 'Connectors — AROS'], ['/plugins', 'Plugins — AROS'],
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

  // Admin panel -> marketplace admin (independent of the shell)
  if (path.startsWith('/admin') && isAdmin) {
    window.location.href = MARKETPLACE_ADMIN_URL;
    return null;
  }

  // The chat-first shell owns every onboarded authenticated route — including
  // /developers and /submit-plugin (its 'developers' section). The legacy
  // Shell and its `?redesign=0` escape hatch were removed 2026-07-22 once the
  // legacy shell had no unique routes left.
  return <AppShell />;
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
