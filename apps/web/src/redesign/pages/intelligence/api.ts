export type IntelligenceKind = 'skill' | 'agent' | 'model';

export interface IntelligenceResource {
  id: string;
  name: string;
  description: string;
  status: string;
  provider?: string;
  model?: string;
  capabilities: string[];
  skillsets?: string[];
  source: 'catalog' | 'workspace' | 'gateway';
}

export interface IntelligenceCredentials {
  token?: string;
  tenantId?: string;
}

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

function headers(credentials: IntelligenceCredentials): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(credentials.token ? { Authorization: `Bearer ${credentials.token}` } : {}),
    ...(credentials.tenantId ? { 'x-aros-tenant-id': credentials.tenantId } : {}),
  };
}

async function request(path: string, credentials: IntelligenceCredentials, init?: RequestInit): Promise<any> {
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers(credentials), ...init?.headers } });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || detail?.message || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

const text = (value: unknown) => typeof value === 'string' ? value : '';
const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function normalizeCatalog(item: any, source: IntelligenceResource['source']): IntelligenceResource | null {
  const name = text(item?.name || item?.label || item?.id);
  if (!name) return null;
  return {
    id: text(item?.id || item?.slug || name), name,
    description: text(item?.description || item?.summary || item?.role),
    status: text(item?.status) || 'unknown', provider: text(item?.provider) || undefined,
    model: text(item?.model || item?.config?.model) || undefined,
    capabilities: list(item?.capabilities || item?.skills), source,
    skillsets: list(item?.skillsets || item?.config?.skills),
  };
}

export async function listIntelligence(kind: IntelligenceKind, credentials: IntelligenceCredentials): Promise<IntelligenceResource[]> {
  if (kind === 'agent' && credentials.tenantId) {
    try {
      const data = await request(`/api/workspaces/${encodeURIComponent(credentials.tenantId)}/agents`, credentials);
      if (Array.isArray(data)) return data.map(item => normalizeCatalog(item, 'workspace')).filter(Boolean) as IntelligenceResource[];
    } catch { /* Older AROS deployments expose the generic catalog below. */ }
  }
  if (kind === 'model') {
    try {
      const data = await request('/api/gateway/model-routing', credentials);
      const models = Array.isArray(data?.availableModels) ? data.availableModels : [];
      if (models.length) return models.map((item: any) => ({
        id: text(item.id), name: text(item.name || item.id), description: '', status: 'available',
        provider: text(item.provider) || undefined, capabilities: [], source: 'gateway' as const,
      })).filter((item: IntelligenceResource) => item.id && item.name);
    } catch { /* AROS catalog remains the compatibility source. */ }
  }
  const data = await request(`/api/resources/${kind}`, credentials);
  const resources = Array.isArray(data) ? data : Array.isArray(data?.resources) ? data.resources : [];
  return resources.map((item: any) => normalizeCatalog(item, 'catalog')).filter(Boolean) as IntelligenceResource[];
}

export async function setAgentPaused(agent: IntelligenceResource, paused: boolean, credentials: IntelligenceCredentials) {
  if (agent.source !== 'workspace') throw new Error('Lifecycle controls are not available for catalog-only agents.');
  await request(`/api/agents/${encodeURIComponent(agent.id)}/${paused ? 'pause' : 'resume'}${credentials.tenantId ? `?workspaceId=${encodeURIComponent(credentials.tenantId)}` : ''}`, credentials, { method: 'POST', body: '{}' });
}
