import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import {
  addQuery,
  demoResult,
  missingOperatorScope,
  operatorToolRoute,
  toolsBySurface,
  type Surface
} from './tools.js';

const PORT = Number(process.env.PORT || 5468);
const AROS_API_BASE = (process.env.AROS_API_BASE || '').replace(/\/$/, '');
const PUBLIC_BASE_URL = (process.env.AROS_MCP_PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const OAUTH_ISSUER = (process.env.AROS_OAUTH_ISSUER || 'https://id.shre.ai').replace(/\/$/, '');
const MCP_RESOURCE = process.env.AROS_MCP_RESOURCE || 'https://mcp.shre.ai/aros';
const OPERATOR_MCP_URL = process.env.AROS_OPERATOR_MCP_URL || `${PUBLIC_BASE_URL}/aros/operator`;
const CUSTOMER_MCP_URL = process.env.AROS_CUSTOMER_MCP_URL || `${PUBLIC_BASE_URL}/regulars`;
const DEMO_MODE = process.env.AROS_MCP_DEMO_MODE === 'true';
const OAUTH_AUDIENCE = (process.env.AROS_OAUTH_AUDIENCE || MCP_RESOURCE).split(',').map((item) => item.trim()).filter(Boolean);
const REQUIRED_OPERATOR_SCOPES = (process.env.AROS_OPERATOR_REQUIRED_SCOPES || 'openid').split(',').map((item) => item.trim()).filter(Boolean);
const REQUIRE_OPERATOR_SCOPE = process.env.AROS_REQUIRE_OPERATOR_SCOPE !== 'false';
const OAUTH_DISCOVERY_URL = `${OAUTH_ISSUER}/.well-known/openid-configuration`;

let oauthDiscoveryCache: OAuthDiscovery | null = null;
let oauthDiscoveryLoadedAt = 0;
let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

type ToolCallParams = {
  name?: string;
  arguments?: Record<string, unknown>;
};

type OAuthDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
  introspection_endpoint?: string;
  response_types_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  scopes_supported?: string[];
};

type AuthContext = {
  subject: string;
  tenantId?: string;
  scopes: string[];
  claims: JWTPayload;
};


const server = createServer(async (req, res) => {
  try {
    setCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, {
        ok: true,
        service: '@aros/mcp-aros',
        arosApiConfigured: Boolean(AROS_API_BASE),
        demoMode: DEMO_MODE,
        resource: MCP_RESOURCE
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') {
      json(res, 200, protectedResourceMetadata());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      json(res, 200, await authorizationServerMetadata());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/.well-known/mcp') {
      json(res, 200, mcpMetadata('operator'));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/.well-known/mcp/operator') {
      json(res, 200, mcpMetadata('operator'));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/.well-known/mcp/customer') {
      json(res, 200, mcpMetadata('customer'));
      return;
    }

    const surface = surfaceForPath(url.pathname);
    if (req.method === 'POST' && surface) {
      if (!AROS_API_BASE && !DEMO_MODE) {
        unauthorized(res, 'AROS MCP is not configured for production traffic.');
        return;
      }

      if (surface === 'operator' && !DEMO_MODE && !req.headers.authorization) {
        unauthorized(res, 'Connect with NirLab / AROS OAuth before using tools.');
        return;
      }

      if (surface === 'operator' && !DEMO_MODE) {
        const auth = await verifyOperatorAuthorization(req.headers.authorization);
        if (!auth.ok) {
          unauthorized(res, auth.message);
          return;
        }
      }

      const body = await readJson(req);
      const response = await handleJsonRpc(body as JsonRpcRequest, req, surface);
      json(res, 200, response);
      return;
    }

    json(res, 404, { error: 'not_found' });
  } catch (error) {
    json(res, 500, {
      error: 'internal_error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[aros-mcp] listening on 0.0.0.0:${PORT}`);
});

async function handleJsonRpc(request: JsonRpcRequest, req: IncomingMessage, surface: Surface) {
  const id = request.id ?? null;

  if (request.method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: '@aros/mcp-aros', version: '0.1.0' }
    });
  }

  if (request.method === 'notifications/initialized') {
    return rpcResult(id, {});
  }

  if (request.method === 'tools/list') {
    return rpcResult(id, { tools: toolsBySurface[surface] });
  }

  if (request.method === 'tools/call') {
    const result = await callTool(request.params as ToolCallParams, req, surface);
    return rpcResult(id, result);
  }

  return rpcError(id, -32601, `Unsupported method: ${request.method || 'unknown'}`);
}

async function callTool(params: ToolCallParams, req: IncomingMessage, surface: Surface) {
  const name = params?.name || '';
  const args = params?.arguments || {};
  const correlationId = randomUUID();

  if (!toolsBySurface[surface].some((tool) => tool.name === name)) {
    return toolText({ error: 'unknown_tool', name, correlationId }, true);
  }

  if (!AROS_API_BASE && !DEMO_MODE) {
    return toolText({
      error: 'aros_api_not_configured',
      message: 'Set AROS_API_BASE or enable AROS_MCP_DEMO_MODE=true.',
      correlationId
    }, true);
  }

  if (DEMO_MODE && !AROS_API_BASE) {
    return toolText(demoResult(name, args, correlationId, surface));
  }

  const authHeader = req.headers.authorization;
  let authContext: AuthContext | null = null;
  if (surface === 'operator' && !authHeader) {
    return authToolError('Connect with NirLab / AROS OAuth before using this operator tool.', correlationId);
  }

  if (surface === 'operator' && authHeader) {
    const auth = await verifyOperatorAuthorization(authHeader);
    if (!auth.ok) return authToolError(auth.message, correlationId);
    authContext = auth.context;
  }

  if (surface === 'customer') {
    return callCustomerTool(name, args, correlationId, authHeader);
  }

  const operatorAuthHeader = authHeader;
  if (!operatorAuthHeader) {
    return toolText({ error: 'missing_authorization', correlationId }, true);
  }

  // Granular scope gate (aros.inventory.read / aros.exceptions.read) — only
  // binding for tokens that carry aros.* scopes; see tools.ts.
  const missingScope = missingOperatorScope(name, authContext?.scopes ?? []);
  if (missingScope) {
    return authToolError(`Token is missing the required scope ${missingScope}.`, correlationId, 'insufficient_scope', missingScope, {
      error: 'insufficient_scope',
      message: `Token is missing the required scope ${missingScope}.`,
      requiredScope: missingScope,
      correlationId
    });
  }

  const route = operatorToolRoute(name, args);
  if (route) {
    return toolText(await arosFetch(route.path, operatorAuthHeader, correlationId, route.init ?? {}, authContext));
  }

  return toolText({
    error: 'not_implemented',
    message: `${name} needs a dedicated AROS API route before production submission.`,
    correlationId
  }, true);
}

async function callCustomerTool(name: string, args: Record<string, unknown>, correlationId: string, authHeader?: string) {
  const businessSlug = encodeURIComponent(String(args.businessSlug || ''));
  if (!businessSlug) return toolText({ error: 'missing_business_slug', correlationId }, true);

  if (name === 'regulars_get_business_profile') {
    const query = new URLSearchParams();
    addQuery(query, 'storeId', args.storeId);
    return toolText(await arosPublicFetch(`/api/public/businesses/${businessSlug}/profile?${query}`, correlationId, authHeader));
  }

  if (name === 'aros_customer_search_products') {
    const query = new URLSearchParams();
    addQuery(query, 'q', args.query);
    addQuery(query, 'storeId', args.storeId);
    addQuery(query, 'limit', args.limit);
    return toolText(await arosPublicFetch(`/api/public/businesses/${businessSlug}/products?${query}`, correlationId, authHeader));
  }

  if (name === 'aros_customer_get_promotions') {
    const query = new URLSearchParams();
    addQuery(query, 'storeId', args.storeId);
    return toolText(await arosPublicFetch(`/api/public/businesses/${businessSlug}/promotions?${query}`, correlationId, authHeader));
  }

  if (name === 'aros_customer_get_business_hours') {
    const query = new URLSearchParams();
    addQuery(query, 'storeId', args.storeId);
    return toolText(await arosPublicFetch(`/api/public/businesses/${businessSlug}/hours?${query}`, correlationId, authHeader));
  }

  if (name === 'regulars_get_links') {
    const query = new URLSearchParams();
    addQuery(query, 'storeId', args.storeId);
    return toolText(await arosPublicFetch(`/api/public/businesses/${businessSlug}/links?${query}`, correlationId, authHeader));
  }

  return toolText({ error: 'not_implemented', name, correlationId }, true);
}

async function arosFetch(path: string, authHeader: string, correlationId: string, init: RequestInit = {}, authContext: AuthContext | null = null) {
  const response = await fetch(`${AROS_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      'X-AROS-Channel': 'marketplace-mcp',
      'X-Correlation-Id': correlationId,
      ...(authContext?.tenantId ? { 'X-AROS-Tenant-Id': authContext.tenantId } : {}),
      ...(authContext?.subject ? { 'X-AROS-Subject': authContext.subject } : {}),
      ...(init.headers || {})
    }
  });

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    correlationId,
    payload
  };
}

async function arosPublicFetch(path: string, correlationId: string, authHeader?: string, init: RequestInit = {}) {
  const response = await fetch(`${AROS_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(authHeader ? { Authorization: authHeader } : {}),
      'Content-Type': 'application/json',
      'X-AROS-Channel': 'customer-mcp',
      'X-Correlation-Id': correlationId,
      ...(init.headers || {})
    }
  });

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    correlationId,
    payload
  };
}

function toolText(payload: unknown, isError = false) {
  return {
    isError,
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function authToolError(description: string, correlationId: string, error = 'invalid_token', scope?: string, payload?: Record<string, unknown>) {
  const challenge = bearerChallenge(description, error, scope);
  return {
    ...toolText(payload || { error: 'authorization_required', message: description, correlationId }, true),
    _meta: {
      'mcp/www_authenticate': [challenge]
    }
  };
}

function rpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function setCors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function surfaceForPath(pathname: string): Surface | null {
  if (pathname === '/mcp' || pathname === '/mcp/operator' || pathname === '/aros/operator') return 'operator';
  if (pathname === '/mcp/customer' || pathname === '/aros/customer' || pathname === '/regulars') return 'customer';
  return null;
}

function unauthorized(res: ServerResponse, description: string) {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': bearerChallenge(description)
  });
  res.end(JSON.stringify({ error: 'unauthorized', message: description }));
}

function bearerChallenge(description: string, error = 'invalid_token', scope?: string) {
  const parts = [
    `resource_metadata="${PUBLIC_BASE_URL}/.well-known/oauth-protected-resource"`,
    `error="${error.replace(/"/g, "'")}"`,
    `error_description="${description.replace(/"/g, "'")}"`
  ];
  if (scope) parts.push(`scope="${scope.replace(/"/g, "'")}"`);
  return `Bearer ${parts.join(', ')}`;
}

async function verifyOperatorAuthorization(authHeader?: string): Promise<{ ok: true; context: AuthContext } | { ok: false; message: string }> {
  const token = bearerToken(authHeader);
  if (!token) return { ok: false, message: 'Missing bearer token.' };

  try {
    const discovery = await oauthDiscovery();
    if (!remoteJwks) remoteJwks = createRemoteJWKSet(new URL(discovery.jwks_uri));

    const { payload } = await jwtVerify(token, remoteJwks, {
      issuer: discovery.issuer || OAUTH_ISSUER,
      audience: OAUTH_AUDIENCE.length ? OAUTH_AUDIENCE : undefined,
      clockTolerance: 5
    });

    const scopes = scopesFromClaims(payload);
    const missingScopes = REQUIRED_OPERATOR_SCOPES.filter((scope) => !scopes.includes(scope));
    if (REQUIRE_OPERATOR_SCOPE && missingScopes.length) {
      return { ok: false, message: `Token missing required scope(s): ${missingScopes.join(', ')}.` };
    }

    return {
      ok: true,
      context: {
        subject: payload.sub || 'unknown',
        tenantId: tenantFromClaims(payload),
        scopes,
        claims: payload
      }
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `Invalid bearer token: ${error.message}` : 'Invalid bearer token.'
    };
  }
}

function bearerToken(authHeader?: string) {
  const match = /^Bearer\s+(.+)$/i.exec(authHeader || '');
  return match?.[1]?.trim() || '';
}

function scopesFromClaims(payload: JWTPayload) {
  const values = [payload.scope, payload.scp, payload.scopes].flatMap((value) => {
    if (typeof value === 'string') return value.split(/\s+/);
    if (Array.isArray(value)) return value.map(String);
    return [];
  });
  return [...new Set(values.filter(Boolean))];
}

function tenantFromClaims(payload: JWTPayload) {
  const value = payload.tenant_id || payload.workspace_id || payload['urn:zitadel:iam:org:id'];
  return typeof value === 'string' ? value : undefined;
}

async function oauthDiscovery() {
  const now = Date.now();
  if (oauthDiscoveryCache && now - oauthDiscoveryLoadedAt < 3_600_000) return oauthDiscoveryCache;

  const response = await fetch(OAUTH_DISCOVERY_URL);
  if (!response.ok) throw new Error(`OAuth discovery failed with ${response.status}`);
  const body = await response.json() as OAuthDiscovery;
  if (!body.issuer || !body.authorization_endpoint || !body.token_endpoint || !body.jwks_uri) {
    throw new Error('OAuth discovery document is incomplete.');
  }
  oauthDiscoveryCache = body;
  oauthDiscoveryLoadedAt = now;
  remoteJwks = createRemoteJWKSet(new URL(body.jwks_uri));
  return body;
}

function protectedResourceMetadata() {
  return {
    resource: MCP_RESOURCE,
    authorization_servers: [OAUTH_ISSUER],
    scopes_supported: [
      'aros.store.read',
      'aros.connector.read',
      'aros.inventory.read',
      'aros.exceptions.read',
      'aros.action.draft'
    ],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://aros.live/docs/marketplace'
  };
}

async function authorizationServerMetadata() {
  try {
    const discovery = await oauthDiscovery();
    return {
      ...discovery,
      scopes_supported: [...new Set([...(discovery.scopes_supported || []), ...protectedResourceMetadata().scopes_supported])]
    };
  } catch {
    return {
      issuer: OAUTH_ISSUER,
      authorization_endpoint: `${OAUTH_ISSUER}/oauth/v2/authorize`,
      token_endpoint: `${OAUTH_ISSUER}/oauth/v2/token`,
      jwks_uri: `${OAUTH_ISSUER}/oauth/v2/keys`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      scopes_supported: protectedResourceMetadata().scopes_supported
    };
  }
}

function mcpMetadata(surface: Surface) {
  const toolset = toolsBySurface[surface];
  const endpoint = surface === 'operator' ? OPERATOR_MCP_URL : CUSTOMER_MCP_URL;
  return {
    name: surface === 'operator' ? 'AROS Retail Operations' : 'Regulars',
    publisher: 'Nirlab Inc.',
    description: surface === 'operator'
      ? 'Remote MCP server for AROS retail operations intelligence.'
      : 'Remote MCP server for read-only Regulars business profiles, catalog search, promotions, hours, and approved links.',
    endpoint,
    transport: 'streamable-http',
    auth: {
      type: surface === 'operator' ? 'oauth2' : 'public-read-only',
      issuer: OAUTH_ISSUER,
      resource: MCP_RESOURCE,
      scopes: surface === 'operator'
        ? protectedResourceMetadata().scopes_supported
        : ['regulars.profile.read', 'regulars.catalog.read', 'regulars.promotions.read', 'regulars.hours.read', 'regulars.links.read']
    },
    tools: toolset.map((tool) => ({
      name: tool.name,
      description: tool.description,
      annotations: tool.annotations || {}
    }))
  };
}
