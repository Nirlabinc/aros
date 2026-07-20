/**
 * Client for the flag-gated terms/consent layer (TERMS_GATE_ENABLED).
 *
 * The server is the single source of truth: the SPA learns whether the gate
 * is on, the current versions, and the caller's acceptance state from
 * GET /api/terms/status. When the flag is off the status returns
 * gateEnabled:false and every consent surface renders nothing — current
 * behavior unchanged.
 */

import { useEffect, useState } from 'react';

export interface TermsStatus {
  gateEnabled: boolean;
  termsVersion: string;
  privacyVersion: string;
  aiChatDisclosureKey: string;
  /** null = unknown/unauthenticated (never block on unknown) */
  accepted: boolean | null;
  previouslyAccepted: boolean | null;
  aiDisclosureAcknowledged: boolean | null;
}

type AuthArgs = { accessToken?: string | null; tenantId?: string | null };

function authHeaders({ accessToken, tenantId }: AuthArgs): Record<string, string> {
  return {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(tenantId ? { 'x-aros-tenant-id': tenantId } : {}),
  };
}

// Module-level cache: one status fetch per session (invalidated on accept/ack).
let cached: TermsStatus | null = null;
let inflight: Promise<TermsStatus | null> | null = null;
let cachedKey = '';
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function invalidateTermsStatus(): void {
  cached = null;
  inflight = null;
}

export async function fetchTermsStatus(args: AuthArgs): Promise<TermsStatus | null> {
  const key = `${args.accessToken || ''}:${args.tenantId || ''}`;
  if (cached && cachedKey === key) return cached;
  if (inflight && cachedKey === key) return inflight;
  cachedKey = key;
  inflight = (async () => {
    try {
      const res = await fetch('/api/terms/status', { headers: authHeaders(args) });
      if (!res.ok) return null; // fail open — consent must never brick the app
      const data = (await res.json()) as TermsStatus;
      if (typeof data?.gateEnabled !== 'boolean') return null;
      cached = data;
      notify();
      return data;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function acceptTerms(args: AuthArgs): Promise<boolean> {
  try {
    const res = await fetch('/api/terms/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(args) },
      body: JSON.stringify({ accepted: true }),
    });
    if (!res.ok) return false;
    invalidateTermsStatus();
    notify();
    return true;
  } catch {
    return false;
  }
}

export async function ackAiDisclosure(args: AuthArgs, disclosureKey: string): Promise<boolean> {
  try {
    const res = await fetch('/api/disclosures/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(args) },
      body: JSON.stringify({ disclosureKey }),
    });
    if (!res.ok) return false;
    invalidateTermsStatus();
    notify();
    return true;
  } catch {
    return false;
  }
}

/**
 * Shared hook over the cached status. Returns null while loading or when the
 * endpoint is unreachable — callers treat null as "do not block".
 */
export function useTermsStatus(args: AuthArgs): TermsStatus | null {
  const [status, setStatus] = useState<TermsStatus | null>(cached);
  useEffect(() => {
    let alive = true;
    const update = () => { if (alive) setStatus(cached); };
    listeners.add(update);
    void fetchTermsStatus(args).then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; listeners.delete(update); };
  }, [args.accessToken, args.tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  return status;
}
