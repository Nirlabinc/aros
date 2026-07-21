const base = (process.env.AROS_MCP_SMOKE_BASE || 'http://127.0.0.1:5468').replace(/\/$/, '');

async function get(path) {
  const res = await fetch(`${base}${path}`);
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} returned ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function post(path, payload) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} returned ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const request = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

const health = await get('/health');
const operatorMeta = await get('/.well-known/mcp/operator');
const customerMeta = await get('/.well-known/mcp/customer');
const resource = await get('/.well-known/oauth-protected-resource');
const operatorTools = await post('/aros/operator', request);
const regularsTools = await post('/regulars', request);
const legacyCustomerTools = await post('/aros/customer', request);

const result = {
  healthOk: health.ok === true,
  resource: resource.resource,
  operatorEndpoint: operatorMeta.endpoint,
  regularsEndpoint: customerMeta.endpoint,
  operatorToolCount: operatorTools.result?.tools?.length || 0,
  regularsToolCount: regularsTools.result?.tools?.length || 0,
  legacyCustomerToolCount: legacyCustomerTools.result?.tools?.length || 0
};

if (!result.healthOk) throw new Error('health failed');
if (result.operatorToolCount < 5) throw new Error(`expected >=5 operator tools, got ${result.operatorToolCount}`);
if (result.regularsEndpoint !== `${base}/regulars`) throw new Error(`unexpected Regulars endpoint ${result.regularsEndpoint}`);
if (result.regularsToolCount !== 5) throw new Error(`expected 5 Regulars tools, got ${result.regularsToolCount}`);
if (result.legacyCustomerToolCount !== 5) throw new Error(`expected 5 legacy customer tools, got ${result.legacyCustomerToolCount}`);

console.log(JSON.stringify(result, null, 2));
