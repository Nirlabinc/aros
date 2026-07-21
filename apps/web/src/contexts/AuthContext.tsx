import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { centralIdentityOnly, supabase } from '../lib/supabase';
import { fetchOnboardingStatus, type ModelChoice } from '../onboarding/api';

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

const ACTIVE_TENANT_STORAGE_KEY = 'aros.activeTenantId';
const MEMBERSHIP_FETCH_TIMEOUT_MS = 12000;
const MEMBERSHIP_FETCH_ATTEMPTS = 2;
const MEMBERSHIP_RETRY_DELAYS_MS = [500];

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan: string;
  onboarding_completed: boolean;
  created_at: string;
  timezone?: string;
  currency?: string;
  status?: string;
}

export interface TenantMembership {
  tenant_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  is_default: boolean;
  status: 'active' | 'invited' | 'suspended';
  tenant: Tenant;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  /** All tenants the user is an active member of */
  memberships: TenantMembership[];
  /** The currently selected tenant (from picker or default). Null if user has no memberships. */
  tenant: Tenant | null;
  loading: boolean;
  membershipError: string | null;
  /** Persisted onboarding_progress.step (resumable, cross-device). Null until loaded. */
  onboardingStep: number | null;
  /** Persisted onboarding_progress.step_data (e.g. the chosen model). */
  onboardingStepData: { model?: ModelChoice; [key: string]: unknown };
  /** True while the resumable onboarding progress is being resolved. */
  onboardingLoading: boolean;
  refreshOnboarding: () => Promise<void>;
  selectTenant: (tenantId: string) => void;
  refreshMemberships: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, metadata: Record<string, string>) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchMemberships(userId: string): Promise<TenantMembership[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MEMBERSHIP_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), MEMBERSHIP_FETCH_TIMEOUT_MS);
    try {
    const query = supabase
      .from('tenant_members')
      .select('tenant_id, role, is_default, status, tenant:tenants(*)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .abortSignal(controller.signal);
    const { data, error } = await query;
    window.clearTimeout(timeoutId);
    if (error) throw error;
    if (!data) throw new Error('Membership lookup returned no result');
    return (data as unknown as TenantMembership[]).filter((m) => !!m.tenant);
    } catch (error) {
      window.clearTimeout(timeoutId);
      lastError = controller.signal.aborted ? new Error('Membership lookup timed out') : error;
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      if (code === '42703' || code.startsWith('PGRST2')) {
        console.error(`[AuthContext] Supabase schema drift (${code}): tenant membership query failed. Apply the production schema catch-up.`, error);
      } else if (attempt < MEMBERSHIP_FETCH_ATTEMPTS - 1) {
        // Non-final attempts routinely abort when a login redirect tears the
        // page down mid-fetch ("Failed to fetch" on every session) — warn,
        // don't error: only the FINAL failure is a real problem.
        console.warn(`[AuthContext] Tenant membership query failed (attempt ${attempt + 1}/${MEMBERSHIP_FETCH_ATTEMPTS}), retrying: ${message}`);
      } else {
        console.error(`[AuthContext] Tenant membership query failed (attempt ${attempt + 1}/${MEMBERSHIP_FETCH_ATTEMPTS}): ${message}`, error);
      }
      if (attempt < MEMBERSHIP_FETCH_ATTEMPTS - 1) {
        await sleep(MEMBERSHIP_RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not load tenant memberships');
}

function pickActiveTenant(memberships: TenantMembership[], storedId: string | null): Tenant | null {
  if (memberships.length === 0) return null;
  if (storedId) {
    const hit = memberships.find((m) => m.tenant.id === storedId);
    if (hit) return hit.tenant;
  }
  const def = memberships.find((m) => m.is_default);
  if (def) return def.tenant;
  // role priority: owner > admin > member > viewer
  const rank: Record<string, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
  const sorted = [...memberships].sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9));
  return sorted[0].tenant;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  const [onboardingStepData, setOnboardingStepData] = useState<{ model?: ModelChoice; [key: string]: unknown }>({});
  const [onboardingLoading, setOnboardingLoading] = useState(false);

  const refreshOnboarding = useCallback(async () => {
    // Central-identity workspaces are always treated as onboarded; there is no
    // Supabase-backed progress row to resolve.
    if (centralIdentityOnly || !tenant?.id || !session?.access_token) {
      setOnboardingStep(null);
      setOnboardingStepData({});
      setOnboardingLoading(false);
      return;
    }
    if (tenant.onboarding_completed) {
      setOnboardingStep(null);
      setOnboardingStepData({});
      setOnboardingLoading(false);
      return;
    }
    setOnboardingLoading(true);
    const status = await fetchOnboardingStatus({ accessToken: session.access_token, tenantId: tenant.id });
    // Fall back to step 1 (a genuinely new workspace) when the status endpoint
    // is unreachable, rather than blocking the journey.
    setOnboardingStep(status ? status.step : 1);
    setOnboardingStepData(status ? status.stepData : {});
    setOnboardingLoading(false);
  }, [tenant?.id, tenant?.onboarding_completed, session?.access_token]);

  useEffect(() => {
    void refreshOnboarding();
  }, [refreshOnboarding]);

  const hydrateUser = useCallback(async (s: Session | null) => {
    setSession(s);
    setUser(s?.user ?? null);
    if (!s?.user) {
      setMemberships([]);
      setTenant(null);
      setMembershipError(null);
      return;
    }
    setMembershipError(null);
    let mems: TenantMembership[];
    try {
      mems = await fetchMemberships(s.user.id);
    } catch {
      setMemberships([]);
      setTenant(null);
      setMembershipError('We could not load your workspace memberships. This may be a temporary service or schema issue.');
      return;
    }
    setMemberships(mems);
    const storedId = localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY);
    const active = pickActiveTenant(mems, storedId);
    setTenant(active);
    if (active) localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, active.id);
  }, []);

  const hydrateUserAndSettle = useCallback(async (s: Session | null) => {
    try {
      await hydrateUser(s);
    } finally {
      setLoading(false);
    }
  }, [hydrateUser]);

  const refreshMemberships = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    setMembershipError(null);
    let mems: TenantMembership[];
    try {
      mems = await fetchMemberships(session.user.id);
    } catch {
      setMembershipError('We could not load your workspace memberships. This may be a temporary service or schema issue.');
      setLoading(false);
      return;
    }
    setMemberships(mems);
    const storedId = localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY);
    const active = pickActiveTenant(mems, storedId);
    setTenant(active);
    if (active) localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, active.id);
    setLoading(false);
  }, [session]);

  useEffect(() => {
    if (centralIdentityOnly) {
      fetch(`${API_BASE}/auth/session`, { credentials: 'include' }).then(async response => {
        if (!response.ok) return;
        const identity = await response.json() as { subject: string; workspaceId: string; role: TenantMembership['role'] };
        const centralUser = { id: identity.subject, aud: 'authenticated', role: 'authenticated', email: '', user_metadata: {}, app_metadata: { role: identity.role } } as unknown as User;
        const centralTenant = { id: identity.workspaceId, name: 'Your workspace', slug: identity.workspaceId, owner_id: '', plan: '', onboarding_completed: true, created_at: '' };
        setUser(centralUser); setSession({ user: centralUser, access_token: '', refresh_token: '', expires_in: 3600, token_type: 'bearer' } as Session); setTenant(centralTenant);
        setMemberships([{ tenant_id: identity.workspaceId, role: identity.role, is_default: true, status: 'active', tenant: centralTenant }]);
      }).catch(() => undefined).finally(() => setLoading(false));
      return;
    }
    supabase.auth.getSession()
      .then(({ data: { session: s } }) => hydrateUserAndSettle(s))
      .catch(() => {
        setSession(null);
        setUser(null);
        setMemberships([]);
        setTenant(null);
      })
      .finally(() => setLoading(false));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setTimeout(() => {
          void hydrateUserAndSettle(s);
        }, 0);
      },
    );
    return () => subscription.unsubscribe();
  }, [hydrateUserAndSettle]);

  const selectTenant = useCallback((tenantId: string) => {
    const hit = memberships.find((m) => m.tenant.id === tenantId);
    if (!hit) return;
    setTenant(hit.tenant);
    localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, tenantId);
  }, [memberships]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (centralIdentityOnly) { window.location.assign(`/auth/oidc/start?returnTo=${encodeURIComponent('/dashboard')}`); return { error: null }; }
    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || 'Login failed' };
      if (data.session?.access_token && data.session?.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        return { error: error?.message ?? null };
      }

      // Some legacy /api/login deployments authenticate with a server cookie
      // but do not return the Supabase tokens this SPA needs for ProtectedRoute.
      // Require a browser session before reporting success, otherwise the
      // dashboard redirect immediately bounces back to the login screen.
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    } catch {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, metadata: Record<string, string>) => {
    if (centralIdentityOnly) return { error: 'Use the central AROS signup flow.' };
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata },
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    if (centralIdentityOnly) await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
    else await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setMemberships([]);
    setTenant(null);
    sessionStorage.removeItem('aros-auth-token');
    sessionStorage.removeItem('aros-auth-user');
    localStorage.removeItem('aros-auth-token');
    localStorage.removeItem('aros-auth-user');
    localStorage.removeItem('aros-onboarding-complete');
    localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY);
    window.location.href = '/login';
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    return { error: error?.message ?? null };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        memberships,
        tenant,
        loading,
        membershipError,
        onboardingStep,
        onboardingStepData,
        onboardingLoading,
        refreshOnboarding,
        selectTenant,
        refreshMemberships,
        signIn,
        signUp,
        signOut,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
