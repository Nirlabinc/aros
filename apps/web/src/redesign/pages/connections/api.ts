export type AuthScope = { accessToken?: string; tenantId?: string };

export type StoreConnectorType = 'rapidrms-api' | 'verifone-commander' | 'azure-db';
export type StoreConnector = {
  id: string;
  type: StoreConnectorType;
  name: string;
  config?: { description?: string; accessMode?: 'read' | 'read_write'; [key: string]: unknown };
  status: 'pending' | 'connected' | 'disconnected' | 'error';
  last_tested?: string | null;
  last_error?: string | null;
  created_at?: string;
};

export type AppCapabilityBundle = {
  tools: string[];
  skills: Array<{ name: string; capabilities: string[] }>;
  agents: Array<{ name: string; capabilities: string[] }>;
};

export type PlatformApp = {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  required_scopes?: string[] | null;
  url?: string | null;
  launch_url?: string | null;
  icon?: string | null;
  repo?: string | null;
  vault_namespace?: string | null;
  bundle?: AppCapabilityBundle | null;
};

export type UnlockedDelta = { app?: string; skills: string[]; agents: string[]; tools: string[]; activationState?: string };

export type CapabilityResource = { id: string; name: string; provider?: string | null; status?: string | null; capabilities?: string[] | null };

export type AppGrant = {
  app_key: string;
  status: string;
  service_config?: { scopes?: string[]; storeIds?: string[]; activationState?: string } | null;
  enabled_at?: string | null;
  source?: string | null;
};

export type StoreSyncJob = { id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; progress: number; from_date: string; to_date: string; days_synced: number; rows_imported?: number; last_error?: string | null };

const apiBase = () => (window as Window & { __AROS_API_URL__?: string }).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

function headers(auth: AuthScope): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
    ...(auth.tenantId ? { 'X-AROS-Tenant-Id': auth.tenantId } : {}),
  };
}

async function request<T>(path: string, auth: AuthScope, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers: { ...headers(auth), ...init.headers } });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export async function listStores(auth: AuthScope): Promise<StoreConnector[]> {
  return (await request<{ connectors?: StoreConnector[] }>('/api/connectors', auth)).connectors || [];
}

export async function createStore(auth: AuthScope, input: {
  type: StoreConnectorType; name: string; config: Record<string, unknown>; secrets: Record<string, string>;
}): Promise<StoreConnector> {
  const result = await request<{ connector: StoreConnector }>('/api/connectors', auth, { method: 'POST', body: JSON.stringify(input) });
  return result.connector;
}

export async function testStore(auth: AuthScope, id: string): Promise<boolean> {
  const result = await request<{ result?: { success?: boolean } }>('/api/connectors/test', auth, { method: 'POST', body: JSON.stringify({ id }) });
  return Boolean(result.result?.success);
}

export async function updateStore(auth: AuthScope, id: string, input: { name: string; description: string; accessMode: 'read' | 'read_write'; config?: Record<string, unknown>; secrets?: Record<string, string> }): Promise<StoreConnector> {
  const result = await request<{ connector: StoreConnector }>('/api/connectors', auth, { method: 'PATCH', body: JSON.stringify({ id, ...input }) });
  return result.connector;
}

export async function removeStore(auth: AuthScope, id: string): Promise<void> {
  await request(`/api/connectors?id=${encodeURIComponent(id)}`, auth, { method: 'DELETE' });
}

export async function listStoreSyncs(auth: AuthScope): Promise<StoreSyncJob[]> {
  return (await request<{ jobs?: StoreSyncJob[] }>('/api/store/sync', auth)).jobs || [];
}

export async function startStoreSync(auth: AuthScope, months = 12): Promise<StoreSyncJob> {
  return (await request<{ job: StoreSyncJob }>('/api/store/sync', auth, { method: 'POST', body: JSON.stringify({ months, chunkDays: 7 }) })).job;
}

export async function listApps(auth: AuthScope): Promise<{ apps: PlatformApp[]; grants: AppGrant[] }> {
  const data = await request<{ apps?: Array<PlatformApp & { launch_url?: string | null }>; grants?: AppGrant[] }>('/api/apps', auth);
  return { apps: (data.apps || []).map(app => ({ ...app, url: app.url || app.launch_url || null })), grants: data.grants || [] };
}

export async function listCapabilityResources(auth: AuthScope, kind: 'skill' | 'agent'): Promise<CapabilityResource[]> {
  const data = await request<{ resources?: CapabilityResource[] }>(`/api/resources/${kind}`, auth);
  return data.resources || [];
}

export async function grantApp(auth: AuthScope, app: PlatformApp, storeIds: string[] = []): Promise<UnlockedDelta | null> {
  const result = await request<{ unlocked?: UnlockedDelta }>(`/api/apps/${encodeURIComponent(app.id)}/grant`, auth, {
    method: 'POST', body: JSON.stringify({ scopes: app.required_scopes || [], storeIds }),
  });
  return result.unlocked ?? null;
}

export async function disableApp(auth: AuthScope, appId: string): Promise<void> {
  await request(`/api/marketplace/apps/${encodeURIComponent(appId)}/disable`, auth, { method: 'POST' });
}

export async function listMarketplaceEntitlements(auth: AuthScope): Promise<AppGrant[]> {
  const data = await request<{ entitlements?: AppGrant[] }>('/api/marketplace/entitlements', auth);
  return data.entitlements || [];
}

export async function createAppLaunch(auth: AuthScope, appId: string): Promise<string> {
  const result = await request<{ launchUrl: string }>(`/api/apps/${encodeURIComponent(appId)}/launch`, auth, { method: 'POST' });
  if (!result.launchUrl) throw new Error('The app did not return a launch destination');
  return result.launchUrl;
}

