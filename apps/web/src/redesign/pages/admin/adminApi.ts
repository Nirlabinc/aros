import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';

export const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

export class AdminApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export function useAdminRequest<T>(path: string | null) {
  const { session, tenant } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      credentials: 'include',
      headers: {
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}),
      },
    }).then(async response => {
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new AdminApiError(payload?.error || `Request failed (${response.status})`, response.status);
      setData(payload as T);
    }).catch(error => {
      if (error?.name !== 'AbortError') setError(error instanceof Error ? error.message : 'Unable to load this page.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, session?.access_token, tenant?.id, attempt]);
  return { data, loading, error, retry };
}

export async function postAdmin(path: string, body: unknown, accessToken?: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new AdminApiError(payload?.error || `Request failed (${response.status})`, response.status);
  return payload;
}
