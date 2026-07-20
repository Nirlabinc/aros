import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── Lazy singletons ──────────────────────────────────────────────────────

let _client: SupabaseClient | null = null;
let _admin: SupabaseClient | null = null;

/**
 * Public Supabase client (anon key).
 * Safe for browser-side or server-side calls that respect RLS.
 */
export function createSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_ANON_KEY. ' +
        'Set these environment variables for Supabase-backed deployment.',
    );
  }

  _client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false, // server-side — no localStorage
    },
  });

  return _client;
}

/**
 * Admin Supabase client (service role key).
 * Bypasses RLS — use only for server-side admin operations.
 */
export function createSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'Set these environment variables for server-side Supabase operations.',
    );
  }

  _admin = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _admin;
}

/**
 * Ephemeral client for credential verification (signInWithPassword etc.).
 * Returns a FRESH client every call and must never be cached: a successful
 * sign-in stores the user's session on the client, and any shared client
 * (admin or anon singleton) would from then on send that user's JWT on every
 * PostgREST request — silently downgrading service-role queries to
 * RLS-scoped ones until the captured session expires.
 */
export function createSupabaseAuthClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY. ' +
        'Set these environment variables for credential verification.',
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/** Reset singletons (useful for testing or config reload). */
export function resetSupabaseClients(): void {
  _client = null;
  _admin = null;
}
