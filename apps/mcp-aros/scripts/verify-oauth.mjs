const base = (process.env.AROS_MCP_VERIFY_BASE || 'https://mcp.shre.ai').replace(/\/$/, '');
const token = process.env.AROS_MCP_VERIFY_TOKEN || '';

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function get(path) {
  const res = await fetch(`${base}${path}`);
  const body = await readJson(res);
  if (!res.ok) throw new Error(`${path} returned ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function post(path, payload, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });
  return { status: res.status, headers: res.headers, body: await readJson(res) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const request = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

const health = await get('/health');
const resource = await get('/.well-known/oauth-protected-resource');
const authServer = await get('/.well-known/oauth-authorization-server');

assert(health.ok === true, 'health check did not return ok=true');
assert(resource.resource === 'https://mcp.shre.ai/aros', `unexpected resource ${resource.resource}`);
assert(authServer.issuer === 'https://id.shre.ai', `unexpected issuer ${authServer.issuer}`);
assert(authServer.jwks_uri === 'https://id.shre.ai/oauth/v2/keys', `unexpected jwks_uri ${authServer.jwks_uri}`);
assert((authServer.code_challenge_methods_supported || []).includes('S256'), 'S256 PKCE is not advertised');

const unauthenticated = await post('/aros/operator', request);

if (token) {
  const authenticated = await post('/aros/operator', request, {
    authorization: `Bearer ${token}`
  });
  assert(
    authenticated.status === 200,
    `expected authenticated operator call to return 200, got ${authenticated.status}: ${JSON.stringify(authenticated.body)}`
  );
  assert(
    (authenticated.body?.result?.tools || []).length >= 5,
    `expected at least 5 operator tools, got ${authenticated.body?.result?.tools?.length || 0}`
  );
} else if (health.demoMode === false) {
  assert(
    unauthenticated.status === 401,
    `expected unauthenticated operator call to return 401 in production mode, got ${unauthenticated.status}`
  );
  assert(
    unauthenticated.headers.get('www-authenticate'),
    'expected WWW-Authenticate header in 401 response'
  );
}

console.log(JSON.stringify({
  base,
  healthOk: health.ok === true,
  demoMode: health.demoMode,
  issuer: authServer.issuer,
  resource: resource.resource,
  unauthenticatedStatus: unauthenticated.status,
  authenticatedStatus: token ? 200 : 'not-tested'
}, null, 2));
