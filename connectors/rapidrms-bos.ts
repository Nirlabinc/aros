export type RapidRmsBosCredentials = {
  email?: string;
  username?: string;
  password?: string;
};

export type RapidRmsBosConfig = {
  bosBaseUrl?: string;
  timezone?: string;
};

type CookieJar = Map<string, string>;

export type BosTimecardRecord = {
  employeeId: string | null;
  employeeName: string | null;
  clockId: string | null;
  clockDate: string | null;
  clockIn: string | null;
  clockOut: string | null;
  totalHours: number | null;
  status: string | null;
  isVoid: boolean;
};

export type BosEmployeeHours = {
  employeeId: string | null;
  employeeName: string | null;
  totalHours: number;
  punchCount: number;
  openPunches: number;
  voidedPunches: number;
};

export type BosTimecardReport = {
  from: string;
  to: string;
  employeeFilter: string | null;
  rows: BosTimecardRecord[];
  employees: BosEmployeeHours[];
  totals: {
    hours: number;
    punches: number;
    openPunches: number;
    voidedPunches: number;
  };
  source: 'RapidRMS BOS';
  fetchedAt: string;
};

const DEFAULT_BOS_BASE_URL = 'https://www.rapidrms.com';
const DEFAULT_TIMEZONE = 'America/New_York';

const EMPLOYEE_ID_FIELDS = ['employeeId', 'EmployeeId', 'employeeID', 'empId', 'EmpId', 'userId', 'UserId', 'cashierId', 'CashierId', 'id', 'Id'];
const EMPLOYEE_NAME_FIELDS = ['employeeName', 'EmployeeName', 'empName', 'EmpName', 'userName', 'UserName', 'cashierName', 'CashierName', 'name', 'Name'];
const CLOCK_ID_FIELDS = ['clockId', 'ClockId', 'timeClockId', 'TimeClockId', 'id', 'Id'];
const CLOCK_DATE_FIELDS = ['clockDate', 'ClockDate', 'date', 'Date', 'businessDate', 'BusinessDate'];
const CLOCK_IN_FIELDS = ['clockIn', 'ClockIn', 'clockInTime', 'ClockInTime', 'clock_in', 'ClockInDateTime', 'clockInDateTime', 'InTime', 'inTime'];
const CLOCK_OUT_FIELDS = ['clockOut', 'ClockOut', 'clockOutTime', 'ClockOutTime', 'clock_out', 'ClockOutDateTime', 'clockOutDateTime', 'OutTime', 'outTime'];
const HOURS_FIELDS = ['workingHours', 'WorkingHours', 'workHours', 'WorkHours', 'totalHours', 'TotalHours', 'hours', 'Hours'];
const SECONDS_FIELDS = ['workingSeconds', 'WorkingSeconds', 'workSeconds', 'WorkSeconds', 'totalSeconds', 'TotalSeconds'];
const STATUS_FIELDS = ['status', 'Status', 'clockStatus', 'ClockStatus'];
const VOID_FIELDS = ['isVoid', 'IsVoid', 'void', 'Void', 'isDeleted', 'IsDeleted'];

function normalizeBaseUrl(value?: string): string {
  return String(value || process.env.RAPIDRMS_BOS_URL || DEFAULT_BOS_BASE_URL).replace(/\/$/, '');
}

function absolute(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString();
}

function updateCookies(jar: CookieJar, headers: Headers): void {
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const values = raw.length ? raw : headers.get('set-cookie') ? [String(headers.get('set-cookie'))] : [];
  for (const header of values) {
    const first = header.split(';')[0];
    const idx = first.indexOf('=');
    if (idx > 0) jar.set(first.slice(0, idx), first.slice(idx + 1));
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function fetchWithCookies(jar: CookieJar, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (jar.size) headers.set('Cookie', cookieHeader(jar));
  headers.set('User-Agent', 'AROS-RapidRMS-BOS-read/1.0');
  const res = await fetch(url, { ...init, headers, redirect: 'manual' });
  updateCookies(jar, res.headers);
  return res;
}

export function hiddenInputs(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const inputRe = /<input\b[^>]*>/gi;
  const attrRe = /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of html.matchAll(inputRe)) {
    const input = match[0];
    const attrs: Record<string, string> = {};
    for (const attr of input.matchAll(attrRe)) attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? '';
    if (String(attrs.type || '').toLowerCase() !== 'hidden') continue;
    const name = attrs.name || attrs.id;
    if (name) fields[name] = attrs.value || '';
  }
  return fields;
}

export function parseRowsFromBosPayload(text: string): Array<Record<string, unknown>> {
  let payload: unknown = text;
  try { payload = JSON.parse(text); } catch {}
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch {}
  }
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['data', 'Data', 'rows', 'Rows', 'result', 'Result', 'aaData']) {
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

function boolValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function pickStr(row: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = row[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNum(row: Record<string, unknown>, names: string[]): number | null {
  for (const name of names) {
    const value = row[name];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function parseDurationHours(value: string | null): number | null {
  if (!value) return null;
  const parts = value.trim().match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (!parts) return null;
  const hours = Number(parts[1]);
  const minutes = Number(parts[2]);
  const seconds = Number(parts[3] || 0);
  return Math.round((hours + minutes / 60 + seconds / 3600) * 1000) / 1000;
}

function normalizeDateTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

function normalizeBusinessDate(value: string | null): string | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (iso) return iso;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : value;
}

export function bosDateTime(day: string, edge: 'start' | 'end'): string {
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid BOS day: ${day}`);
  return `${Number(match[2])}/${Number(match[3])}/${match[1]} ${edge === 'start' ? '12:00 AM' : '11:59 PM'}`;
}

export function bosLocalDateTime(now: Date = new Date(), timezone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(now);
}

export function normalizeBosTimecardRow(row: Record<string, unknown>): BosTimecardRecord {
  const seconds = pickNum(row, SECONDS_FIELDS);
  const hours = pickNum(row, HOURS_FIELDS) ?? (seconds === null ? parseDurationHours(pickStr(row, HOURS_FIELDS)) : Math.round((seconds / 3600) * 1000) / 1000);
  let isVoid = VOID_FIELDS.some((field) => boolValue(row[field]));
  const status = pickStr(row, STATUS_FIELDS);
  if (status && /\b(void|deleted|inactive)\b/i.test(status)) isVoid = true;
  return {
    employeeId: pickStr(row, EMPLOYEE_ID_FIELDS),
    employeeName: pickStr(row, EMPLOYEE_NAME_FIELDS),
    clockId: pickStr(row, CLOCK_ID_FIELDS),
    clockDate: normalizeBusinessDate(pickStr(row, CLOCK_DATE_FIELDS) || pickStr(row, CLOCK_IN_FIELDS)),
    clockIn: normalizeDateTime(pickStr(row, CLOCK_IN_FIELDS)),
    clockOut: normalizeDateTime(pickStr(row, CLOCK_OUT_FIELDS)),
    totalHours: hours,
    status,
    isVoid,
  };
}

export function summarizeBosTimecards(rows: BosTimecardRecord[]): BosTimecardReport['employees'] {
  const byEmployee = new Map<string, BosEmployeeHours>();
  for (const row of rows) {
    const key = row.employeeId || row.employeeName || 'unknown';
    const current = byEmployee.get(key) || {
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      totalHours: 0,
      punchCount: 0,
      openPunches: 0,
      voidedPunches: 0,
    };
    current.punchCount++;
    current.totalHours += row.isVoid ? 0 : row.totalHours ?? 0;
    if (!row.clockOut && !row.isVoid) current.openPunches++;
    if (row.isVoid) current.voidedPunches++;
    byEmployee.set(key, current);
  }
  return [...byEmployee.values()]
    .map((row) => ({ ...row, totalHours: Math.round(row.totalHours * 1000) / 1000 }))
    .sort((a, b) => b.totalHours - a.totalHours || String(a.employeeName || a.employeeId || '').localeCompare(String(b.employeeName || b.employeeId || '')));
}

function filterEmployee(rows: BosTimecardRecord[], employee?: string): BosTimecardRecord[] {
  const needle = employee?.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => row.employeeId?.toLowerCase() === needle || row.employeeName?.toLowerCase().includes(needle));
}

export function buildBosTimecardReport(
  rawRows: Array<Record<string, unknown>>,
  from: string,
  to: string,
  employee?: string,
): BosTimecardReport {
  const rows = filterEmployee(rawRows.map(normalizeBosTimecardRow), employee);
  const employees = summarizeBosTimecards(rows);
  const totals = employees.reduce((sum, employeeRow) => ({
    hours: sum.hours + employeeRow.totalHours,
    punches: sum.punches + employeeRow.punchCount,
    openPunches: sum.openPunches + employeeRow.openPunches,
    voidedPunches: sum.voidedPunches + employeeRow.voidedPunches,
  }), { hours: 0, punches: 0, openPunches: 0, voidedPunches: 0 });
  return {
    from,
    to,
    employeeFilter: employee?.trim() || null,
    rows,
    employees,
    totals: { ...totals, hours: Math.round(totals.hours * 1000) / 1000 },
    source: 'RapidRMS BOS',
    fetchedAt: new Date().toISOString(),
  };
}

async function bosLogin(config: RapidRmsBosConfig, credentials: RapidRmsBosCredentials): Promise<{ jar: CookieJar; baseUrl: string }> {
  const baseUrl = normalizeBaseUrl(config.bosBaseUrl);
  const userName = credentials.email || credentials.username || '';
  const password = credentials.password || '';
  if (!userName || !password) throw new Error('RapidRMS BOS credentials are missing username/password');

  const jar: CookieJar = new Map();
  const loginGet = await fetchWithCookies(jar, absolute(baseUrl, '/Account/Branchlogin'));
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
  const loginPost = await fetchWithCookies(jar, absolute(baseUrl, '/Account/CheckLogin'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: absolute(baseUrl, '/Account/Branchlogin') },
    body,
  });
  let landingUrl = loginPost.headers.get('location') ? absolute(baseUrl, String(loginPost.headers.get('location'))) : absolute(baseUrl, '/Dashboard');
  for (let i = 0; i < 5; i++) {
    const landing = await fetchWithCookies(jar, landingUrl, { headers: { Referer: absolute(baseUrl, '/Account/Branchlogin') } });
    const location = landing.headers.get('location');
    if (location && landing.status >= 300 && landing.status < 400) {
      landingUrl = absolute(baseUrl, location);
      continue;
    }
    const html = await landing.text();
    if (/Account\/Branchlogin|name=["']UserName["']/i.test(html)) throw new Error('RapidRMS BOS login was rejected');
    return { jar, baseUrl };
  }
  throw new Error('RapidRMS BOS login redirect did not settle');
}

async function bosReadRows(jar: CookieJar, baseUrl: string, path: string, params: Record<string, string>): Promise<Array<Record<string, unknown>>> {
  const url = new URL(path, `${baseUrl}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetchWithCookies(jar, url.toString(), { headers: { Referer: absolute(baseUrl, '/TimeStamp') } });
  if (!res.ok) throw new Error(`RapidRMS BOS ${path}: ${res.status} ${res.statusText}`);
  return parseRowsFromBosPayload(await res.text());
}

export async function fetchBosTimecards(
  config: RapidRmsBosConfig,
  credentials: RapidRmsBosCredentials,
  from: string,
  to: string,
  employee?: string,
): Promise<BosTimecardReport> {
  const { jar, baseUrl } = await bosLogin(config, credentials);
  const params = {
    TimeDuration: 'Custom',
    FromDate: bosDateTime(from, 'start'),
    ToDate: bosDateTime(to, 'end'),
    LocalDateTime: bosLocalDateTime(new Date(), config.timezone || DEFAULT_TIMEZONE),
    SelectedEmp: '',
  };
  const rows = await bosReadRows(jar, baseUrl, '/TimeStamp/GetEmployeeReportData', params);
  return buildBosTimecardReport(rows, from, to, employee);
}
