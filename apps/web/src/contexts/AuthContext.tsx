import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

const ACTIVE_TENANT_STORAGE_KEY = 'aros.activeTenantId';
const MEMBERSHIP_FETCH_TIMEOUT_MS = 5000;

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
  is_default?: boolean;
  status?: 'active' | 'invited' | 'suspended';
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
  selectTenant: (tenantId: string) => void;
  refreshMemberships: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, metadata: Record<string, string>) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMemberships(userId: string): Promise<TenantMembership[]> {
  try {
    const query = supabase
      .from('tenant_members')
      .select('tenant_id, role, tenant:tenants(*)')
      .eq('user_id', userId);
    const { data, error } = await Promise.race([
      query,
      new Promise<{ data: null; error: Error }>((resolve) => {
        window.setTimeout(
          () => resolve({ data: null, error: new Error('Membership lookup timed out') }),
          MEMBERSHIP_FETCH_TIMEOUT_MS,
        );
      }),
    ]);
    if (error || !data) return [];
    return (data as unknown as TenantMembership[]).filter((m) => !!m.tenant);
  } catch {
    return [];
  }
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

  const hydrateUser = useCallback(async (s: Session | null) => {
    setSession(s);
    setUser(s?.user ?? null);
    if (!s?.user) {
      setMemberships([]);
      setTenant(null);
      return;
    }
    const mems = await fetchMemberships(s.user.id);
    setMemberships(mems);
    const storedId = localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY);
    const active = pickActiveTenant(mems, storedId);
    setTenant(active);
    if (active) localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, active.id);
  }, []);

  const refreshMemberships = useCallback(async () => {
    if (!session?.user) return;
    const mems = await fetchMemberships(session.user.id);
    setMemberships(mems);
    const storedId = localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY);
    const active = pickActiveTenant(mems, storedId);
    setTenant(active);
    if (active) localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, active.id);
  }, [session]);

  useEffect(() => {
    supabase.auth.getSession()
      .then(async ({ data: { session: s } }) => {
        await hydrateUser(s);
      })
      .catch(() => {
        setSession(null);
        setUser(null);
        setMemberships([]);
        setTenant(null);
      })
      .finally(() => setLoading(false));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, s) => {
        await hydrateUser(s);
      },
    );
    return () => subscription.unsubscribe();
  }, [hydrateUser]);

  const selectTenant = useCallback((tenantId: string) => {
    const hit = memberships.find((m) => m.tenant.id === tenantId);
    if (!hit) return;
    setTenant(hit.tenant);
    localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, tenantId);
  }, [memberships]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || 'Login failed' };
      if (data.session?.access_token && data.session?.refresh_token) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      }
      return { error: null };
    } catch {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, metadata: Record<string, string>) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata },
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
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
