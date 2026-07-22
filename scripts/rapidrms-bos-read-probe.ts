import { createHash } from 'node:crypto';
import { createSupabaseAdmin } from '../src/supabase.js';
import { decryptValue, setEncryptionKey } from '../security/input-handler.js';

type Cookie = { name: string; value: string };

const BOS_BASE_URL = String(process.env.RAPIDRMS_BOS_URL || 'https://www.rapidrms.com').replace(/\/$/, '');
const TARGET_PATH = process.env.RAPIDRMS_BOS_PATH || '/TimeStamp';

function boolEnv(name: string): boolean {
  return ['1', 'true', 'yes'].includes(String(process.env[name] || '').toLowerCase());
}

const SMOKE_READS = boolEnv('RAPIDRMS_BOS_SMOKE_READS');

function updateCookies(jar: Map<string, string>, headers: Headers): void {
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const values = raw.length ? raw : headers.get('set-cookie') ? [String(headers.get('set-cookie'))] : [];
  for (const header of values) {
    const first = header.split(';')[0];
    const idx = first.indexOf('=');
    if (idx > 0) jar.set(first.slice(0, idx), first.slice(idx + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function absolute(path: string): string {
  return new URL(path, `${BOS_BASE_URL}/`).toString();
}

function bosDay(): string {
  const d = process.env.RAPIDRMS_BOS_DATE ? new Date(`${process.env.RAPIDRMS_BOS_DATE}T12:00:00`) : new Date(Date.now() - 86_400_000);
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }).format(d);
}

function hiddenInputs(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const inputRe = /<input\b[^>]*>/gi;
  const attrRe = /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of html.matchAll(inputRe)) {
    const input = match[0];
    const attrs: Record<string, string> = {};
    for (const attr of input.matchAll(attrRe)) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? '';
    }
    if (String(attrs.type || '').toLowerCase() !== 'hidden') continue;
    const name = attrs.name || attrs.id;
    if (name) fields[name] = attrs.value || '';
  }
  return fields;
}

function pageSummary(html: string): Record<string, unknown> {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || '';
  const formActions = [...html.matchAll(/<form\b[^>]*\baction=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map((m) => m[1] ?? m[2] ?? m[3])
    .slice(0, 20);
  const inputNames = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bname=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map((m) => m[1] ?? m[2] ?? m[3])
    .filter((name, idx, all) => name && all.indexOf(name) === idx)
    .slice(0, 60);
  const tableHeaders = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 80);
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map((m) => m[1] ?? m[2] ?? m[3])
    .slice(0, 80);
  const ajaxHints = [...html.matchAll(/(?:(?:url|href|action)\s*:\s*)?["']([^"']*(?:TimeStamp|Timestamp|TimeClock|Hourly|Tender|Report|DropAmount|GiftCard)[^"']*)["']/gi)]
    .map((m) => m[1])
    .filter((value, idx, all) => value && all.indexOf(value) === idx)
    .slice(0, 80);
  return {
    title,
    bytes: html.length,
    formActions,
    inputNames,
    tableHeaders,
    scripts,
    ajaxHints,
    hasAdd: /\bAdd\b/i.test(html),
    hasApply: /\bApply\b/i.test(html),
    hasSave: /\bSave\b/i.test(html),
  };
}

function endpointHints(text: string): string[] {
  return [...text.matchAll(/(?:(?:url|href|action)\s*:\s*)?["']([^"']*(?:TimeStamp|Timestamp|TimeClock|ClockIn|ClockOut|Shift|Hourly|Tender|Report|DropAmount|GiftCard)[^"']*)["']/gi)]
    .map((m) => m[1])
    .filter((value, idx, all) => value && all.indexOf(value) === idx)
    .slice(0, 120);
}

function parseRowsFromBosPayload(text: string): Array<Record<string, unknown>> {
  let payload: unknown = text;
  try { payload = JSON.parse(text); } catch {}
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch {}
  }
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['data', 'Data', 'rows', 'Rows', 'result', 'Result']) {
      const nested = obj[key];
      if (Array.isArray(nested)) return nested as Array<Record<string, unknown>>;
      if (typeof nested === 'string') {
        try {
          const parsed = JSON.parse(nested);
          if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
        } catch {}
      }
    }
  }
  return [];
}

async function smokeReadEndpoint(
  jar: Map<string, string>,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(path, `${BOS_BASE_URL}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetchWithCookies(jar, url.toString(), { headers: { Referer: absolute(TARGET_PATH) } });
  const text = await res.text();
  const rows = parseRowsFromBosPayload(text);
  return {
    path,
    status: res.status,
    bytes: text.length,
    rowCount: rows.length,
    keys: rows[0] ? Object.keys(rows[0]).slice(0, 40) : [],
    preview: text.replace(/\s+/g, ' ').slice(0, 220),
  };
}

async function fetchWithCookies(jar: Map<string, string>, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (jar.size) headers.set('Cookie', cookieHeader(jar));
  headers.set('User-Agent', 'AROS-BOS-read-probe/1.0');
  const res = await fetch(url, { ...init, headers, redirect: 'manual' });
  updateCookies(jar, res.headers);
  return res;
}

const secret = process.env.AROS_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (secret) setEncryptionKey(createHash('sha256').update(secret).digest());

const supabase = createSupabaseAdmin();
const connectorId = process.env.RAPIDRMS_BOS_CONNECTOR_ID || process.env.RAPIDRMS_PROBE_CONNECTOR_ID;
let query = supabase
  .from('tenant_connectors')
  .select('id,tenant_id,type,name,config,status,credentials_encrypted')
  .eq('type', 'rapidrms-api')
  .eq('status', 'connected')
  .limit(1);
if (connectorId) query = query.eq('id', connectorId);
const { data, error } = await query;
if (error) throw error;
const row = (data || [])[0];
if (!row) {
  console.log(JSON.stringify({ connectedRapidRmsStores: 0, bosBaseUrl: BOS_BASE_URL, targetPath: TARGET_PATH }, null, 2));
  process.exit(0);
}

const secrets = JSON.parse(decryptValue(row.credentials_encrypted)) as Record<string, string>;
const userName = secrets.email || secrets.username || '';
const password = secrets.password || '';
if (!userName || !password) throw new Error('Connected RapidRMS connector is missing BOS username/password secrets');

const jar = new Map<string, string>();
const loginGet = await fetchWithCookies(jar, absolute('/Account/Branchlogin'));
const loginHtml = await loginGet.text();
const hidden = hiddenInputs(loginHtml);
const body = new URLSearchParams({
  ...hidden,
  hdnStoreName: hidden.hdnStoreName || '',
  hdnConfigurationId: hidden.hdnConfigurationId || '0',
  UserName: userName,
  Password: password,
  RememberLogin: 'false',
});

const loginPost = await fetchWithCookies(jar, absolute('/Account/CheckLogin'), {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Referer: absolute('/Account/Branchlogin'),
  },
  body,
});
const loginLocation = loginPost.headers.get('location') || '';
let landingUrl = loginLocation ? absolute(loginLocation) : absolute('/Dashboard');
let loginPostText = '';
if (!loginLocation) loginPostText = await loginPost.text();
for (let i = 0; i < 5; i++) {
  const res = await fetchWithCookies(jar, landingUrl, { headers: { Referer: absolute('/Account/Branchlogin') } });
  const location = res.headers.get('location');
  if (location && res.status >= 300 && res.status < 400) {
    landingUrl = absolute(location);
    continue;
  }
  const html = await res.text();
  const loggedIn = !/Account\/Branchlogin|id=["']UserName["']|name=["']UserName["']/i.test(html);
  const targetRes = loggedIn
    ? await fetchWithCookies(jar, absolute(TARGET_PATH), { headers: { Referer: landingUrl } })
    : null;
  const targetHtml = targetRes ? await targetRes.text() : '';
  const targetSummary = pageSummary(targetHtml);
  const scriptDetails = [];
  for (const src of ((targetSummary.scripts as string[]) || []).filter((script) => /TimeStamp|ClockInOut/i.test(script)).slice(0, 8)) {
    const scriptRes = await fetchWithCookies(jar, absolute(src), { headers: { Referer: absolute(TARGET_PATH) } });
    const scriptText = await scriptRes.text();
    scriptDetails.push({
      src,
      status: scriptRes.status,
      bytes: scriptText.length,
      endpointHints: endpointHints(scriptText),
      preview: scriptText.replace(/\s+/g, ' ').slice(0, 260),
    });
  }
  const smokeReads = [];
  if (loggedIn && SMOKE_READS) {
    const day = bosDay();
    const from = process.env.RAPIDRMS_BOS_FROM || `${day} 12:00 AM`;
    const to = process.env.RAPIDRMS_BOS_TO || `${day} 11:59 PM`;
    const local = process.env.RAPIDRMS_BOS_LOCAL_DATETIME || new Intl.DateTimeFormat('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date());
    smokeReads.push(await smokeReadEndpoint(jar, '/TimeStamp/GetEmployeeReportData', {
      TimeDuration: 'Custom',
      FromDate: from,
      ToDate: to,
      LocalDateTime: local,
      SelectedEmp: '',
    }));
    smokeReads.push(await smokeReadEndpoint(jar, '/ClockInOut/ClockInOutSummaryReportData', {
      TimeDuration: 'Custom',
      FromDate: from,
      ToDate: to,
      LocalDateTime: local,
      SelectedEmp: '',
    }));
  }
  console.log(JSON.stringify({
    store: row.name,
    tenant: boolEnv('RAPIDRMS_BOS_INCLUDE_TENANT') ? row.tenant_id : 'redacted',
    bosBaseUrl: BOS_BASE_URL,
    login: {
      getStatus: loginGet.status,
      postStatus: loginPost.status,
      postLocation: loginLocation,
      landingUrl,
      loggedIn,
      loginFailurePreview: loggedIn ? '' : loginPostText.replace(/\s+/g, ' ').slice(0, 220),
      cookieNames: [...jar.keys()].filter((name) => !/auth|token|session/i.test(name)).slice(0, 20),
      sensitiveCookieCount: [...jar.keys()].filter((name) => /auth|token|session/i.test(name)).length,
    },
    target: targetRes ? {
      path: TARGET_PATH,
      status: targetRes.status,
      location: targetRes.headers.get('location') || '',
      summary: targetSummary,
      scriptDetails,
      smokeReads,
    } : null,
  }, null, 2));
  process.exit(0);
}

throw new Error(`BOS login redirect did not settle from ${landingUrl}`);
