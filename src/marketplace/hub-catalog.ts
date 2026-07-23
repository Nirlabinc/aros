/**
 * shre-hub catalog integration (capability-hub mission, Phase 2).
 *
 * Behind SHRE_HUB_CATALOG_ENABLED the marketplace catalog is served from the
 * central hub; AROS stays system-of-record — the hub reads our platform_apps
 * back through /api/internal/catalog/* (which never consults the hub, so the
 * chain cannot recurse) and adds the fleet capability manifests on top.
 * Fallback on any hub failure is the local query, so the flag is
 * roll-back-safe by construction.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export interface HubCapability {
  id: string;
  kind: string;
  status: string;
  ui?: { title: string; category: string; summary?: string; icon?: string };
  entitlement?: { installable: boolean; requires_terms?: boolean };
  [key: string]: unknown;
}

export interface HubCatalogResult {
  ok: boolean;
  apps: Record<string, unknown>[];
  capabilities: HubCapability[];
  error?: string;
}

export async function fetchHubCatalog(
  baseUrl: string | undefined,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<HubCatalogResult> {
  if (!baseUrl || !token) return { ok: false, apps: [], capabilities: [], error: 'hub not configured' };
  try {
    const res = await fetchImpl(`${baseUrl}/catalog`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, apps: [], capabilities: [], error: `hub responded ${res.status}` };
    const body = (await res.json()) as { apps?: Record<string, unknown>[]; capabilities?: HubCapability[] };
    return { ok: true, apps: body.apps ?? [], capabilities: body.capabilities ?? [] };
  } catch (e) {
    return { ok: false, apps: [], capabilities: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// Source selection for the marketplace catalog: hub apps when the hub call
// succeeded AND returned a non-empty list (an empty hub apps list means the
// hub's read-back of OUR data failed upstream — local is more truthful),
// local rows otherwise.
export function selectCatalogSource<T>(
  localApps: T[],
  hub: HubCatalogResult,
): { apps: T[]; capabilities: HubCapability[]; catalog_source: 'shre-hub' | 'local' } {
  if (hub.ok && hub.apps.length > 0) {
    return { apps: hub.apps as T[], capabilities: hub.capabilities, catalog_source: 'shre-hub' };
  }
  return { apps: localApps, capabilities: hub.ok ? hub.capabilities : [], catalog_source: 'local' };
}

// Bearer guard for /api/internal/catalog/* — constant-time, fail-closed.
export function internalCatalogAuthorized(
  authorizationHeader: string | undefined,
  expectedToken: string | undefined,
): 'ok' | 'unconfigured' | 'unauthorized' {
  if (!expectedToken) return 'unconfigured';
  const presented = authorizationHeader?.startsWith('Bearer ') ? authorizationHeader.slice(7) : '';
  if (!presented) return 'unauthorized';
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(expectedToken), digest(presented)) ? 'ok' : 'unauthorized';
}
