import { createHash } from 'node:crypto';
import { createSupabaseAdmin } from '../src/supabase.js';
import { decryptValue, setEncryptionKey } from '../security/input-handler.js';
import { setTenantSecret, storeCredential, deleteCredential } from '../connectors/vault-ref.js';
import { authenticate } from '../connectors/rapidrms-api.js';
import { invoiceDayBounds } from '../connectors/data-service.js';
import type { RapidRmsSession } from '../connectors/types.js';

type Method = 'GET' | 'POST';
type Family = 'timeclock' | 'reports' | 'all';
type Candidate = {
  family: Exclude<Family, 'all'>;
  name: string;
  method: Method;
  path: string;
  params: Record<string, unknown>;
};

const READ_ONLY_WORDS = /(get|list|report|search|filter|summary|history|detail|index|all)/i;
const MUTATION_WORDS = /(add|save|update|edit|delete|remove|void|clockin|clockout|approve|import|upload|sync|generate|create|post|put)/i;

function probeDate(): string {
  return process.env.RAPIDRMS_DISCOVERY_DATE || process.env.RAPIDRMS_PROBE_DATE || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

function familyFilter(): Family {
  const value = String(process.env.RAPIDRMS_DISCOVERY_FAMILY || 'all').toLowerCase();
  return value === 'timeclock' || value === 'reports' ? value : 'all';
}

function boolEnv(name: string): boolean {
  return ['1', 'true', 'yes'].includes(String(process.env[name] || '').toLowerCase());
}

function toRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text) return [];
    try { return toRows(JSON.parse(text)); } catch { return []; }
  }
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['data', 'Data', 'rows', 'Rows', 'result', 'Result', 'items', 'Items', 'value']) {
      const rows = toRows(obj[key]);
      if (rows.length) return rows;
    }
  }
  return [];
}

function sampleKeys(payload: unknown): string[] {
  const rows = toRows(payload);
  const first = rows[0];
  if (first && typeof first === 'object') return Object.keys(first).slice(0, 24);
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return Object.keys(payload as Record<string, unknown>).slice(0, 24);
  return [];
}

function preview(payloadText: string): string {
  return payloadText.replace(/\s+/g, ' ').slice(0, 220);
}

function hasUsefulPayload(payload: unknown, text: string): boolean {
  const rows = toRows(payload);
  if (rows.length > 0) return true;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return text.trim().length > 16 && !/No Data available/i.test(text);
  const envelope = payload as Record<string, unknown>;
  const data = envelope.data ?? envelope.Data ?? envelope.result ?? envelope.Result ?? envelope.value;
  if (data === '' || data === null || data === undefined) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === 'string') return data.trim().length > 0 && !/No Data available/i.test(data);
  if (typeof data === 'object') return Object.keys(data as Record<string, unknown>).length > 0;
  return true;
}

function isProbablyReadOnly(candidate: Candidate): boolean {
  if (MUTATION_WORDS.test(candidate.path)) return false;
  if (candidate.method === 'GET') return true;
  return READ_ONLY_WORDS.test(candidate.path);
}

function dateParamVariants(day: string): Array<{ label: string; params: Record<string, unknown> }> {
  const bounds = invoiceDayBounds(day, day);
  return [
    { label: 'pascalBounds', params: bounds },
    { label: 'camelBounds', params: { fromDate: bounds.FromDate, toDate: bounds.ToDate } },
    { label: 'startEnd', params: { StartDate: bounds.FromDate, EndDate: bounds.ToDate } },
    { label: 'lowerStartEnd', params: { startDate: bounds.FromDate, endDate: bounds.ToDate } },
    { label: 'businessDate', params: { Date: day, date: day } },
  ];
}

function reportPaths(): Array<{ name: string; path: string }> {
  const bases = [
    'TenderReport',
    'HourlyReport',
    'FuelReport',
    'FuelDetailsReport',
    'DropAmountReport',
    'GiftCardInventory',
    'ReportItemSold/Tax',
    'ReportItemSold/Department',
    'ReportItemSold/Vendor',
    'Discount/SalesByPromotion',
    'SalesByPromotion',
  ];
  const suffixes = ['', '/Get', '/GetAll', '/List', '/Report', '/Search'];
  return bases.flatMap((base) => suffixes.map((suffix) => ({
    name: `${base}${suffix || '/root'}`,
    path: `/api/${base}${suffix}`,
  })));
}

function timeclockPaths(): Array<{ name: string; path: string }> {
  const bases = [
    'TimeStamp',
    'Timestamp',
    'TimeClock',
    'EmployeeTimeStamp',
    'EmployeeTimestamp',
    'EmployeeTimeClock',
    'Attendance',
    'Shift',
    'ShiftSummary',
    'Employee',
    'User',
  ];
  const suffixes = ['', '/Get', '/GetAll', '/List', '/Report', '/Search', '/History', '/Summary', '/ByDate', '/ByEmployee'];
  return bases.flatMap((base) => suffixes.map((suffix) => ({
    name: `${base}${suffix || '/root'}`,
    path: `/api/${base}${suffix}`,
  })));
}

function buildCandidates(day: string): Candidate[] {
  const variants = dateParamVariants(day);
  const candidates: Candidate[] = [];
  for (const route of timeclockPaths()) {
    for (const variant of variants) {
      candidates.push({ family: 'timeclock', name: `${route.name}:${variant.label}:GET`, method: 'GET', path: route.path, params: variant.params });
      if (READ_ONLY_WORDS.test(route.path)) {
        candidates.push({ family: 'timeclock', name: `${route.name}:${variant.label}:POST`, method: 'POST', path: route.path, params: variant.params });
      }
    }
  }
  for (const route of reportPaths()) {
    for (const variant of variants) {
      candidates.push({ family: 'reports', name: `${route.name}:${variant.label}:GET`, method: 'GET', path: route.path, params: variant.params });
      if (READ_ONLY_WORDS.test(route.path)) {
        candidates.push({ family: 'reports', name: `${route.name}:${variant.label}:POST`, method: 'POST', path: route.path, params: variant.params });
      }
    }
  }
  return candidates.filter(isProbablyReadOnly);
}

async function rawRequest(session: RapidRmsSession, candidate: Candidate): Promise<Record<string, unknown>> {
  const url = new URL(candidate.path, `${session.config.baseUrl.replace(/\/$/, '')}/`);
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.token}`,
  };
  if (session.dbName) headers.DbName = session.dbName;
  if (session.cookie) headers.Cookie = session.cookie;
  if (candidate.method === 'GET') {
    for (const [key, value] of Object.entries(candidate.params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url, {
    method: candidate.method,
    headers,
    body: candidate.method === 'POST' ? JSON.stringify(candidate.params) : undefined,
  });
  const text = await res.text();
  let payload: unknown = text;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  const rows = toRows(payload);
  const envelope = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  return {
    ...candidate,
    httpStatus: res.status,
    ok: res.ok,
    contentType: res.headers.get('content-type') || '',
    bytes: text.length,
    empty: rows.length === 0 && (text === '' || text === '[]' || /No Data available/i.test(text)),
    useful: hasUsefulPayload(payload, text),
    envelopeError: envelope.isError ?? envelope.IsError ?? null,
    envelopeMessage: String(envelope.message ?? envelope.Message ?? '').slice(0, 180),
    rowCount: rows.length,
    keys: sampleKeys(payload),
    preview: preview(text),
  };
}

const secret = process.env.AROS_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (secret) setEncryptionKey(createHash('sha256').update(secret).digest());

const day = probeDate();
const selectedFamily = familyFilter();
const maxCandidates = Number(process.env.RAPIDRMS_DISCOVERY_LIMIT || 300);
const connectorId = process.env.RAPIDRMS_PROBE_CONNECTOR_ID || process.env.RAPIDRMS_DISCOVERY_CONNECTOR_ID;
const supabase = createSupabaseAdmin();
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
  console.log(JSON.stringify({ connectedRapidRmsStores: 0, reportDate: day, results: [] }, null, 2));
  process.exit(0);
}

const secrets = JSON.parse(decryptValue(row.credentials_encrypted)) as Record<string, string>;
const vaultSecret = `${row.tenant_id}:${process.env.AROS_ENCRYPTION_KEY || 'aros-dev'}`;
setTenantSecret(vaultSecret);
const refs: string[] = [];

try {
  const emailRef = await storeCredential(`${row.id}:discovery-email`, secrets.email || '', vaultSecret);
  const passwordRef = await storeCredential(`${row.id}:discovery-password`, secrets.password || '', vaultSecret);
  refs.push(emailRef, passwordRef);
  const session = await authenticate(
    {
      baseUrl: String(row.config?.baseUrl || 'https://rapidrmsapi.azurewebsites.net'),
      clientId: String(row.config?.clientId || ''),
      sessionTimeout: Number(row.config?.sessionTimeout) || 420,
    },
    emailRef,
    passwordRef,
  );

  const candidates = buildCandidates(day)
    .filter((candidate) => selectedFamily === 'all' || candidate.family === selectedFamily)
    .slice(0, maxCandidates);
  const results: Array<Record<string, unknown>> = [];
  for (const candidate of candidates) {
    try {
      results.push(await rawRequest(session, candidate));
    } catch (err) {
      results.push({
        ...candidate,
        ok: false,
        error: String((err as Error)?.message || err).slice(0, 220),
      });
    }
  }
  const promising = results.filter((result) =>
    result.ok === true &&
    result.httpStatus === 200 &&
    result.envelopeError !== true &&
    result.envelopeError !== 1 &&
    result.envelopeError !== '1' &&
    result.useful === true
  );

  console.log(JSON.stringify({
    store: row.name,
    tenant: boolEnv('RAPIDRMS_DISCOVERY_INCLUDE_TENANT') ? row.tenant_id : 'redacted',
    reportDate: day,
    selectedFamily,
    probed: results.length,
    promising: promising.length,
    results,
  }, null, 2));
} finally {
  await Promise.all(refs.map((ref) => deleteCredential(ref).catch(() => {})));
}
