import { API_BASE, AdminApiError } from './adminApi';

export type WorkspaceAuth = { accessToken?: string; workspaceId: string };
export type WorkspaceRecord = { id: string; name: string; plan?: string; timezone?: string; currency?: string; status?: string };
export type WorkspaceMember = {
  id: string; principalType: string; principalId: string; status: string; membershipRole: string;
  createdAt: string; updatedAt: string; user?: { id: string; name: string; email: string } | null;
};

async function request<T>(auth: WorkspaceAuth, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...init, credentials: 'include',
    headers: {
      'Content-Type': 'application/json', 'x-channel': 'aros', 'X-App-Version': '0.5.0',
      'X-Workspace-ID': auth.workspaceId, 'x-aros-tenant-id': auth.workspaceId,
      ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}), ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new AdminApiError(payload?.error || `Request failed (${response.status})`, response.status);
  return payload as T;
}

export const workspaceApi = {
  get: (auth: WorkspaceAuth) => request<WorkspaceRecord>(auth, `/workspaces/${encodeURIComponent(auth.workspaceId)}`),
  update: (auth: WorkspaceAuth, input: Pick<WorkspaceRecord, 'name' | 'timezone' | 'currency'>) => request<WorkspaceRecord>(auth, `/workspaces/${encodeURIComponent(auth.workspaceId)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  members: (auth: WorkspaceAuth) => request<WorkspaceMember[]>(auth, `/workspaces/${encodeURIComponent(auth.workspaceId)}/members`),
  roles: (auth: WorkspaceAuth) => request<WorkspaceMember[]>(auth, `/workspaces/${encodeURIComponent(auth.workspaceId)}/roles`),
  addMember: (auth: WorkspaceAuth, email: string, role: string) => request<WorkspaceMember>(auth, `/workspaces/${encodeURIComponent(auth.workspaceId)}/members`, { method: 'POST', body: JSON.stringify({ email, role }) }),
  updateRole: (auth: WorkspaceAuth, memberId: string, role: string) => request<{ id: string; membershipRole: string }>(auth, `/workspaces/${encodeURIComponent(auth.workspaceId)}/members/${encodeURIComponent(memberId)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeMember: (auth: WorkspaceAuth, memberId: string) => request<{ id: string }>(auth, `/workspaces/${encodeURIComponent(auth.workspaceId)}/members/${encodeURIComponent(memberId)}`, { method: 'DELETE' }),
};
