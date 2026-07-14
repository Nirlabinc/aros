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
import { ContactPage } from '../pages/contact/ContactPage';
import { CostsPage } from '../pages/costs/CostsPage';
import { BillingPage } from '../pages/billing/BillingPage';
import { ChatWidget } from '../components/ChatWidget';
import { Login } from '../pages/Login';
import { Signup } from '../pages/Signup';
import { StartChat } from '../pages/start/StartChat';
import { ResetPassword } from '../pages/ResetPassword';
import { VerifyEmail } from '../pages/VerifyEmail';

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

  // ── Public auth pages (no session required) ────────────────
  if (path === '/login') {
    if (session && !loading) {
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

  // Contact page — public, no auth required
  if (path === '/contact') {
    return <><ContactPage /><ChatWidget /></>;
  }

  // Landing page at root — only when NOT logged in
  if (path === '/' && !session && !loading) {
    return <><LandingPage /><ChatWidget /></>;
  }

  // ── Auth-required pages ────────────────────────────────────

  // Start — value-first demo chat before setup.
  if (path.startsWith('/start')) {
    return (
      <ProtectedRoute>
        <StartChat />
      </ProtectedRoute>
    );
  }

  // Onboarding — full-screen, no sidebar
  if (path.startsWith('/onboarding')) {
    if (onboarded) {
      window.location.href = "/dashboard";
      return null;
    }
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
  // Gate: new users who haven't completed onboarding get routed to the value-first start page
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

export function App() {
  return (
    <WhitelabelProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </WhitelabelProvider>
  );
}
