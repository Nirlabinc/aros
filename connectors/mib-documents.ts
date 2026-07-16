// ── MIB Documents proxy (Drive-style document storage) ───────────
// MIB (shre-command-center) is the source of truth for document storage. It
// exposes a Drive/Dropbox-style API under `/api/.../drive/*` gated by MIB's own
// better-auth actor. AROS is a different origin (OIDC + Supabase), so it can
// never call MIB directly from the browser. This module is the SERVER-SIDE
// bridge: it forwards an already-authenticated, tenant-resolved AROS request to
// MIB with a service credential and a workspace scope, streaming bodies in both
// directions so uploads and downloads never buffer in memory.
//
// INTEGRATION DEPENDENCY (out of scope here, MIB-side): MIB must accept a
// PER-TENANT service token on its `/drive/*` routes and derive the workspace
// from the `X-Workspace-ID` header so its own `assertWorkspaceAccess` enforces
// tenant isolation. The token is minted/assigned when the Documents app is
// activated for a tenant (see src/server.ts provisionDocumentsAccess) — it is
// NOT a global env var. See the task report for the exact guard.

import type { IncomingMessage, ServerResponse } from 'node:http';

const MIB_DOCS_BASE_URL = (process.env.MIB_DOCS_BASE_URL || 'http://127.0.0.1:5520').replace(/\/$/, '');
// Public host that serves MIB's unauthenticated `/share/:token` page. When set,
// it is forwarded as X-Forwarded-Host/Proto so MIB mints absolute share links
// that point at the reachable public origin rather than the loopback base URL.
const MIB_DOCS_SHARE_BASE_URL = process.env.MIB_DOCS_SHARE_BASE_URL || '';

const HOP_BY_HOP = new Set(['content-encoding', 'transfer-encoding', 'connection', 'keep-alive']);
const METHODS_WITH_BODY = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export interface MibProxyRequest {
  /** HTTP method to send upstream. */
  method: string;
  /** Upstream path on MIB, e.g. `/api/workspaces/<ws>/drive/folders`. */
  upstreamPath: string;
  /** Query string including the leading `?`, or '' for none. */
  search: string;
  /** Resolved MIB workspace id for the caller's tenant. */
  workspaceId: string;
  /**
   * Per-tenant MIB service token, resolved by the caller from the tenant's
   * activated Documents entitlement (never sent by the browser).
   */
  serviceToken: string;
}

/**
 * Forward an AROS request to MIB's document API and stream the response back.
 *
 * The AROS route handler is responsible for authentication and for resolving
 * the tenant → workspace mapping before calling this. This layer only applies
 * the service credential + workspace scope and pipes bytes.
 */
export async function proxyToMib(
  req: IncomingMessage,
  res: ServerResponse,
  spec: MibProxyRequest,
): Promise<void> {
  const upstreamUrl = new URL(`${MIB_DOCS_BASE_URL}${spec.upstreamPath}`);
  if (spec.search) upstreamUrl.search = spec.search.startsWith('?') ? spec.search.slice(1) : spec.search;

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${spec.serviceToken}`);
  headers.set('X-Workspace-ID', spec.workspaceId);
  headers.set('Accept', 'application/json, */*');

  // Preserve the body's content-type (JSON or multipart boundary) and length so
  // MIB's body/multipart parsers see an unmodified payload.
  const contentType = req.headers['content-type'];
  if (contentType) headers.set('Content-Type', Array.isArray(contentType) ? contentType[0] : contentType);
  const contentLength = req.headers['content-length'];
  if (contentLength) headers.set('Content-Length', Array.isArray(contentLength) ? contentLength[0] : contentLength);

  // Let MIB build absolute share URLs that resolve on a public origin.
  if (MIB_DOCS_SHARE_BASE_URL) {
    try {
      const shareBase = new URL(MIB_DOCS_SHARE_BASE_URL);
      headers.set('X-Forwarded-Proto', shareBase.protocol.replace(':', ''));
      headers.set('X-Forwarded-Host', shareBase.host);
    } catch {
      // Ignore a malformed MIB_DOCS_SHARE_BASE_URL — MIB falls back to its host.
    }
  }

  const hasBody = METHODS_WITH_BODY.has(spec.method.toUpperCase()) && Boolean(contentLength || req.headers['transfer-encoding']);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: spec.method,
      headers,
      body: hasBody ? (req as unknown as ReadableStream) : undefined,
      // Node's fetch requires duplex when streaming a request body.
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream request failed';
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Document service unreachable: ${message}` }));
    return;
  }

  const responseHeaders: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    responseHeaders[key] = value;
  });

  res.writeHead(upstream.status, responseHeaders);
  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}
