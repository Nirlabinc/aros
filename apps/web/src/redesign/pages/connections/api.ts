export type AuthScope = { accessToken?: string; tenantId?: string };

export type StoreConnectorType = 'rapidrms-api' | 'verifone-commander' | 'azure-db';
export type StoreConnector = {
  id: string;
  type: StoreConnectorType;
  name: string;
  status: 'pending' | 'connected' | 'disconnected' | 'error';
  last_tested?: string | null;
  last_error?: string | null;
  created_at?: string;
};

export type PlatformApp = {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  required_scopes?: string[] | null;
  url?: string | null;
  icon?: string | null;
};

export type AppGrant = {
  app_key: string;
  status: string;
  service_config?: { scopes?: string[] } | null;
  enabled_at?: string | null;
};

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

export async function removeStore(auth: AuthScope, id: string): Promise<void> {
  await request(`/api/connectors?id=${encodeURIComponent(id)}`, auth, { method: 'DELETE' });
}

export async function listApps(auth: AuthScope): Promise<{ apps: PlatformApp[]; grants: AppGrant[] }> {
  const data = await request<{ apps?: PlatformApp[]; grants?: AppGrant[] }>('/api/apps', auth);
  return { apps: data.apps || [], grants: data.grants || [] };
}

export async function grantApp(auth: AuthScope, app: PlatformApp): Promise<void> {
  await request(`/api/apps/${encodeURIComponent(app.id)}/grant`, auth, {
    method: 'POST', body: JSON.stringify({ scopes: app.required_scopes || [] }),
  });
}

export async function disableApp(auth: AuthScope, appId: string): Promise<void> {
  await request(`/api/marketplace/apps/${encodeURIComponent(appId)}/disable`, auth, { method: 'POST' });
}

