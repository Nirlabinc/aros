import { WhitelabelProvider } from '../whitelabel/WhitelabelProvider';
import { AuthProvider, useAuth as useSupabaseAuth, type Tenant } from '../contexts/AuthContext';
import { ArosChat } from '../aros-ai/ArosChat';
import { Sidebar } from '../components/Sidebar';
import { Dashboard } from '../components/Dashboard';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { OnboardingPage } from '../pages/onboarding/OnboardingPage';
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
import { VerifyEmail } from '../pages/VerifyEmail';
import { ConnectionsHub } from '../pages/settings/ConnectionsHub';
import { AdministrationPage } from '../pages/settings/AdministrationPage';
import AIModelsSettings from '../pages/settings/AIModels';
import { CapabilityCatalog } from '../pages/settings/CapabilityCatalog';
import { ConnectionHealth } from '../pages/settings/ConnectionHealth';
import { centralIdentityOnly } from '../lib/supabase';
import { AppShell } from '../redesign/AppShell';

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

function AppContent() {
  const { user, session, tenant, loading } = useSupabaseAuth();
  const path = window.location.pathname;
  const isAdmin = user?.app_metadata?.role === 'admin' || user?.app_metadata?.role === 'superadmin';
  const onboarded = isOnboardingComplete(tenant);

  // Chat-first redesign preview — self-contained, no auth, for review only.
  if (path.startsWith('/preview/app')) {
    return <AppShell />;
  }

  if (centralIdentityOnly && path !== '/login' && path !== '/signup') {
    const authorize = path === '/oauth/authorize' ? `${path}${window.location.search}` : null;
    window.location.replace(authorize ? `/login?return_to=${encodeURIComponent(authorize)}` : '/login');
    return null;
  }

  // ── Public auth pages (no session required) ────────────────
  if (path === '/login') {
    const isHostedResume = new URLSearchParams(window.location.search).has('return_to');
    if (session && !loading && !isHostedResume) {
      // New users land in the value-first demo chat (/start), not the wizard.
      window.location.href = onboarded ? '/dashboard' : '/start';
      return null;
    }
    return <><Login /><ChatWidget /></>;
  }

  if (path === '/signup') {
    if (session && !loading) {
      window.location.href = onboarded ? '/dashboard' : '/start';
      return null;
    }
    return <><Signup /><ChatWidget /></>;
  }

  if (path === '/reset-password') {
    return <ResetPassword />;
  }

  if (path === '/verify-email') {
    return <VerifyEmail />;
  }

  // Social media templates — public design tool
  if (path === '/social') {
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
  if (path.startsWith('/connect')) {
    return (
      <ProtectedRoute>
        <ConnectStorePage onboarded={onboarded} />
      </ProtectedRoute>
    );
  }

  // Onboarding — full-screen plan + business setup wizard, reached from
  // /connect (or a paid CTA) once the user is sold — not a gate before value.
  if (path.startsWith('/onboarding')) {
    return (
      <ProtectedRoute>
        <OnboardingPage />
      </ProtectedRoute>
    );
  }

  // All remaining routes require auth + onboarding complete
  return (
    <ProtectedRoute>
      <AuthenticatedRoutes path={path} isAdmin={isAdmin} onboarded={onboarded} />
    </ProtectedRoute>
  );
}

function AuthenticatedRoutes({ path, isAdmin, onboarded }: { path: string; isAdmin: boolean; onboarded: boolean }) {
  // Gate: new users who haven't completed onboarding land in the value-first
  // demo chat (/start), not the wizard. The payment callback still resumes the
  // onboarding flow so Stripe round-trips complete.
  if (!onboarded) {
    const params = new URLSearchParams(window.location.search);
    if (params.has('payment')) {
      return <OnboardingPage />;
    }
    window.location.href = '/start';
    return null;
  }

  // Admin panel -> marketplace admin
  if (path.startsWith('/admin') && isAdmin) {
    window.location.href = MARKETPLACE_ADMIN_URL;
    return null;
  }

  // Developers portal
  if (path.startsWith('/developers') || path.startsWith('/submit-plugin')) {
    return (
      <div className="aros-app">
        <Sidebar />
        <main className="aros-main">
          <DeveloperPortal />
        </main>
        <ArosChat />
      </div>
    );
  }

  // Billing
  if (path.startsWith('/billing')) {
    return (
      <div className="aros-app">
        <Sidebar />
        <main className="aros-main">
          <BillingPage />
        </main>
        <ArosChat />
      </div>
    );
  }

  // Costs
  if (path.startsWith('/costs')) {
    return (
      <div className="aros-app">
        <Sidebar />
        <main className="aros-main">
          <CostsPage />
        </main>
        <ArosChat />
      </div>
    );
  }

  const setupRoute = path.startsWith('/stores') ? <ConnectionsHub kind="pos" />
    : path.startsWith('/apps') ? <ConnectionsHub kind="app" />
    : path.startsWith('/channels') ? <CapabilityCatalog kind="channels" />
    : path.startsWith('/agents') ? <CapabilityCatalog kind="agents" />
    : path.startsWith('/skills') ? <CapabilityCatalog kind="skills" />
    : path.startsWith('/models') ? <AIModelsSettings />
    : path.startsWith('/connection-health') ? <ConnectionHealth />
    : path.startsWith('/settings') ? <AdministrationPage section="settings" />
    : path.startsWith('/profile') ? <AdministrationPage section="profile" />
    : path.startsWith('/users') ? <AdministrationPage section="users" />
    : path.startsWith('/workspace') ? <AdministrationPage section="workspace" />
    : null;
  if (setupRoute) return <div className="aros-app"><Sidebar /><main className="aros-main">{setupRoute}</main><ArosChat /></div>;

  // Marketplace
  if (path.startsWith('/marketplace')) {
    return (
      <div className="aros-app">
        <Sidebar />
        <main className="aros-main">
          <MarketplacePage />
        </main>
        <ArosChat />
      </div>
    );
  }

  // Dashboard (default for logged-in users)
  if (path.startsWith('/human')) {
    return (
      <div className="aros-app">
        <Sidebar />
        <main className="aros-main">
          <Dashboard />
        </main>
        <ArosChat />
      </div>
    );
  }

  return (
    <div className="aros-app">
      <Sidebar />
      <main className="aros-main">
        <ConnectStoreBanner />
        <Dashboard />
      </main>
      <ArosChat />
    </div>
  );
}

export function App() {
  return (
    <WhitelabelProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </WhitelabelProvider>
  );
}
