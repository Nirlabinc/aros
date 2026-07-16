// AROS Documents API client. Talks ONLY to the AROS server-side proxy
// (`/api/documents/*`), which forwards to MIB's Drive API with the tenant's
// per-tenant service token. The browser never sees MIB or that token.

export type AuthScope = { accessToken?: string; tenantId?: string };

export interface DocFolder {
  id: string;
  parentId: string | null;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DocFile {
  id: string;
  folderId: string | null;
  name: string;
  contentType: string;
  byteSize: number;
  sha256?: string;
  provider?: string;
  createdAt?: string;
  updatedAt?: string;
  /** MIB-relative content pointer (informational — the UI builds its own URL). */
  contentPath?: string;
}

export type ShareMode = 'view' | 'download';
export type ShareTargetType = 'file' | 'folder';

export interface DocShare {
  id: string;
  targetType: ShareTargetType;
  targetId: string;
  token: string;
  url: string;
  mode: ShareMode;
  hasPassword: boolean;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface FolderListing {
  parentId: string | null;
  folders: DocFolder[];
  files: DocFile[];
}

const apiBase = () => (window as Window & { __AROS_API_URL__?: string }).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

function authHeaders(auth: AuthScope): Record<string, string> {
  return {
    ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
    ...(auth.tenantId ? { 'X-AROS-Tenant-Id': auth.tenantId } : {}),
  };
}

async function requestJson<T>(path: string, auth: AuthScope, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders(auth), ...init.headers },
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

// ── Folders ──────────────────────────────────────────────────────
export function listFolder(auth: AuthScope, parentId: string | null): Promise<FolderListing> {
  const q = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
  return requestJson<FolderListing>(`/api/documents/folders${q}`, auth);
}

export function getTree(auth: AuthScope): Promise<{ folders: DocFolder[] }> {
  return requestJson<{ folders: DocFolder[] }>('/api/documents/tree', auth);
}

export function getFolder(auth: AuthScope, id: string): Promise<{ folder: DocFolder; path: DocFolder[]; folders: DocFolder[]; files: DocFile[] }> {
  return requestJson(`/api/documents/folders/${encodeURIComponent(id)}`, auth);
}

export function createFolder(auth: AuthScope, input: { parentId: string | null; name: string }): Promise<DocFolder> {
  return requestJson<DocFolder>('/api/documents/folders', auth, { method: 'POST', body: JSON.stringify(input) });
}

export function renameFolder(auth: AuthScope, id: string, name: string): Promise<DocFolder> {
  return requestJson<DocFolder>(`/api/documents/folders/${encodeURIComponent(id)}`, auth, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function moveFolder(auth: AuthScope, id: string, parentId: string | null): Promise<DocFolder> {
  return requestJson<DocFolder>(`/api/documents/folders/${encodeURIComponent(id)}`, auth, { method: 'PATCH', body: JSON.stringify({ parentId }) });
}

export function deleteFolder(auth: AuthScope, id: string): Promise<void> {
  return requestJson<void>(`/api/documents/folders/${encodeURIComponent(id)}`, auth, { method: 'DELETE' });
}

// ── Files ────────────────────────────────────────────────────────
export function getFile(auth: AuthScope, id: string): Promise<DocFile & { path: DocFolder[] }> {
  return requestJson(`/api/documents/files/${encodeURIComponent(id)}`, auth);
}

/** Multipart upload — the browser sets the Content-Type boundary itself. */
export async function uploadFile(auth: AuthScope, input: { folderId: string | null; file: File; name?: string }): Promise<DocFile> {
  const form = new FormData();
  form.append('file', input.file);
  if (input.folderId) form.append('folderId', input.folderId);
  if (input.name) form.append('name', input.name);
  const response = await fetch(`${apiBase()}/api/documents/files`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(auth), // no Content-Type: let the browser add the boundary
    body: form,
  });
  const data = await response.json().catch(() => ({})) as DocFile & { error?: string };
  if (!response.ok) throw new Error(data.error || `Upload failed (${response.status})`);
  return data;
}

export function renameFile(auth: AuthScope, id: string, name: string): Promise<DocFile> {
  return requestJson<DocFile>(`/api/documents/files/${encodeURIComponent(id)}`, auth, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function moveFile(auth: AuthScope, id: string, folderId: string | null): Promise<DocFile> {
  return requestJson<DocFile>(`/api/documents/files/${encodeURIComponent(id)}`, auth, { method: 'PATCH', body: JSON.stringify({ folderId }) });
}

export function deleteFile(auth: AuthScope, id: string): Promise<void> {
  return requestJson<void>(`/api/documents/files/${encodeURIComponent(id)}`, auth, { method: 'DELETE' });
}

/**
 * Fetch a file's bytes through the proxy (auth headers attached) and return an
 * object URL. Used for inline image preview and for triggering downloads —
 * a plain <a href> can't carry the Bearer token for token-based sessions.
 */
export async function fetchContentObjectUrl(auth: AuthScope, id: string, download = false): Promise<string> {
  const q = download ? '?download=1' : '';
  const response = await fetch(`${apiBase()}/api/documents/files/${encodeURIComponent(id)}/content${q}`, {
    credentials: 'include',
    headers: authHeaders(auth),
  });
  if (!response.ok) throw new Error(`Could not load file (${response.status})`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

// ── Shares ───────────────────────────────────────────────────────
export function listShares(auth: AuthScope, targetType: ShareTargetType, targetId: string): Promise<{ shares: DocShare[] }> {
  return requestJson(`/api/documents/shares?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`, auth);
}

export function createShare(auth: AuthScope, input: {
  targetType: ShareTargetType; targetId: string; mode: ShareMode; password?: string; expiresAt?: string | null;
}): Promise<DocShare> {
  return requestJson<DocShare>('/api/documents/shares', auth, { method: 'POST', body: JSON.stringify(input) });
}

export function revokeShare(auth: AuthScope, id: string): Promise<void> {
  return requestJson<void>(`/api/documents/shares/${encodeURIComponent(id)}/revoke`, auth, { method: 'POST' });
}

// ── Helpers ──────────────────────────────────────────────────────
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exp;
  return `${value >= 10 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
}

export function isImage(contentType: string): boolean {
  return /^image\//i.test(contentType);
}
