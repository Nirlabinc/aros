#!/usr/bin/env node
/**
 * Journey walk — seam-level HTTP walk of the AROS golden journeys
 * (docs/journeys/) against a deployed surface.
 *
 * Catches the failure class that has actually broken prod: dead routes,
 * built-but-unwired backends (404 where a journey step needs an endpoint),
 * fail-open APIs (200 where auth is required), 5xx on first touch, and raw
 * error strings leaking to users. Unauthenticated, read-only, safe on prod.
 *
 * Steps that need a real browser/session are reported as NEEDS-BROWSER —
 * walk those with the journey-walker subagent (.claude/agents/) or a
 * shre-browser recipe. This script is the fast gate, not the whole gate.
 *
 * Usage:
 *   node scripts/journey-walk.mjs [--base https://app.aros.live] [--journey <slug>] [--json]
 * Exit code: 1 if any step FAILs, else 0.
 */

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = (argOf('--base') || 'https://app.aros.live').replace(/\/$/, '');
const ONLY = argOf('--journey');
const AS_JSON = args.includes('--json');

const RAW_ERROR_TOKENS = [
  'psql', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'Traceback',
  'at Object.', 'at async ', 'TypeError:', 'ReferenceError:',
  'Command failed', 'stack:', 'SQLSTATE',
];

const bodies = []; // every response body we saw, scanned for raw-error leaks

async function probe(method, path, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(BASE + path, {
      method,
      signal: ctl.signal,
      redirect: 'follow',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = (await res.text()).slice(0, 4000);
    bodies.push({ path, status: res.status, text });
    return { status: res.status, type: res.headers.get('content-type') || '', text };
  } catch (e) {
    return { status: 0, type: '', text: String(e && e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

const ev = (r) => `${r.status || 'network-error'} ${r.type.split(';')[0]}`;

/** SPA route serves the app shell. */
const page = (path) => async () => {
  const r = await probe('GET', path);
  if (r.status === 200 && /html/.test(r.type)) return { level: 'PASS', evidence: ev(r) };
  return { level: 'FAIL', evidence: `${ev(r)} — route not serving the app` };
};

/** Auth-required API: fail-closed is the only pass. */
const closedApi = (method, path, body) => async () => {
  const r = await probe(method, path, body);
  if (r.status === 401 || r.status === 403) return { level: 'PASS', evidence: `${r.status} fail-closed` };
  if (r.status === 404) return { level: 'FAIL', evidence: '404 — endpoint missing (built-but-unwired backend)' };
  if (r.status === 200 && /html/.test(r.type)) return { level: 'FAIL', evidence: '200 html — API path swallowed by SPA fallback' };
  if (r.status >= 500 || r.status === 0) return { level: 'FAIL', evidence: `${ev(r)} — server error on a simple probe` };
  if (r.status === 200) return { level: 'FAIL', evidence: '200 — FAIL-OPEN: unauthenticated request succeeded' };
  return { level: 'WARN', evidence: `${ev(r)} — expected 401/403` };
};

/** Endpoint must handle garbage input gracefully (4xx), never crash (5xx). */
const graceful = (method, path, body) => async () => {
  const r = await probe(method, path, body ?? {});
  if (r.status >= 400 && r.status < 500) return { level: 'PASS', evidence: `${r.status} rejected cleanly` };
  if (r.status === 404) return { level: 'FAIL', evidence: '404 — endpoint missing' };
  if (r.status >= 500 || r.status === 0) return { level: 'FAIL', evidence: `${ev(r)} — empty input crashes the endpoint` };
  return { level: 'WARN', evidence: `${ev(r)} — empty submit was accepted?` };
};

const browser = (what) => async () => ({ level: 'NEEDS-BROWSER', evidence: what });

const JOURNEYS = [
  {
    slug: 'preflight',
    title: 'Preflight (surface sanity)',
    steps: [
      ['landing page up', page('/')],
      ['unknown API path is a real 404, not a page', async () => {
        const r = await probe('GET', '/api/__journey_walk_nonexistent__');
        if (r.status === 200 && /html/.test(r.type)) return { level: 'WARN', evidence: '200 html — unknown /api/* falls through to the SPA; missing endpoints can masquerade as pages' };
        if (r.status === 404 || r.status === 401 || r.status === 403) return { level: 'PASS', evidence: `${r.status}` };
        return { level: 'WARN', evidence: ev(r) };
      }],
    ],
  },
  {
    slug: 'sign-up-and-see-value',
    title: 'J1 Sign up and see value',
    steps: [
      ['signup page', page('/signup')],
      ['verify-email page', page('/verify-email')],
      ['/start (demo chat) page', page('/start')],
      ['signup API rejects empty submit cleanly', graceful('POST', '/api/signup')],
      ['verification-email API handles empty submit', graceful('POST', '/api/auth/email-otp/send-verification-otp')],
      ['demo data behind /start is wired', async () => {
        // exactly what StartChat.tsx fetches on mount
        const r = await probe('GET', '/v1/demo/activation?intent=retail');
        if (r.status === 200) return { level: 'PASS', evidence: '200 — demo activation serves' };
        if (r.status === 401 || r.status === 403) return { level: 'WARN', evidence: `${r.status} — demo now auth-gated; confirm /start still gets sample data` };
        return { level: 'FAIL', evidence: `${ev(r)} — demo backend unwired; /start would be an empty chat` };
      }],
      ['sample data is labeled + suggested questions render', browser('needs a session — walk via journey-walker/replay')],
    ],
  },
  {
    slug: 'connect-my-store',
    title: 'J2 Connect my store',
    steps: [
      ['/connect page', page('/connect')],
      ['connectors list API wired + fail-closed', closedApi('GET', '/api/connectors')],
      ['connector save API wired + fail-closed', closedApi('POST', '/api/connectors', {})],
      ['connector test API wired + fail-closed', closedApi('POST', '/api/connectors/test', {})],
      ['onboarding status API wired + fail-closed', closedApi('GET', '/api/onboarding/status')],
      ['onboarding complete is NOT open (historical vuln)', closedApi('POST', '/api/onboarding/complete', {})],
      ['save & test with real creds → dashboard shows own data, sample banner gone', browser('needs test credentials — staged walk')],
    ],
  },
  {
    slug: 'ask-a-question-get-a-real-answer',
    title: 'J3 Ask a question, get a real answer',
    steps: [
      ['chat proxy rejects an unauthenticated/empty request', async () => {
        const r = await probe('POST', '/v1/chat', {});
        if ([400, 401, 403, 422].includes(r.status)) return { level: 'PASS', evidence: `${r.status} rejected` };
        if (r.status === 404) return { level: 'FAIL', evidence: '404 — chat proxy unwired' };
        if (r.status === 200) return { level: 'FAIL', evidence: '200 — FAIL-OPEN: anonymous chat reaches the router (cost + data exposure); if intentional for demo, gate it explicitly' };
        return { level: 'FAIL', evidence: `${ev(r)} — chat proxy unhealthy` };
      }],
      ['answers carry real data + attribution; unconnected tenant gets honest "not connected"', browser('needs a session — verify _shre.toolsUsed non-empty on data questions, no fabricated numbers')],
    ],
  },
  {
    slug: 'check-on-my-store-today',
    title: 'J4 Check on my store today',
    steps: [
      ['/dashboard page', page('/dashboard')],
      ['dashboard API wired + fail-closed', closedApi('GET', '/api/dashboard')],
      ['briefing API wired + fail-closed', closedApi('GET', '/api/human/briefing')],
      ['store summary API wired + fail-closed', closedApi('GET', '/api/store/summary')],
      ['public branding endpoint serves (public by design)', async () => {
        const r = await probe('GET', '/api/branding/public');
        if (r.status === 200) return { level: 'PASS', evidence: '200' };
        return { level: 'WARN', evidence: `${ev(r)} — branding endpoint not serving` };
      }],
      ['numbers are real/timestamped; sample data labeled', browser('needs a connected session')],
    ],
  },
  {
    slug: 'accept-terms-and-ai-disclosure',
    title: 'J6 Accept terms + AI disclosure (flag-gated: TERMS_GATE_ENABLED)',
    steps: [
      ['/legal/terms page serves', page('/legal/terms')],
      ['/legal/privacy page serves', page('/legal/privacy')],
      ['terms status endpoint is wired (public by design)', async () => {
        const r = await probe('GET', '/api/terms/status');
        if (r.status === 200 && /json/.test(r.type)) {
          let flag = '?';
          try { flag = String(JSON.parse(r.text).gateEnabled); } catch { /* ignore */ }
          return { level: 'PASS', evidence: `200 json — gateEnabled=${flag}` };
        }
        if (r.status === 404) return { level: 'FAIL', evidence: '404 — terms status endpoint unwired' };
        return { level: 'WARN', evidence: ev(r) };
      }],
      ['accept endpoint wired + fail-closed', closedApi('POST', '/api/terms/accept', { accepted: true })],
      ['disclosure ack endpoint wired + fail-closed', closedApi('POST', '/api/disclosures/ack', {})],
      ['clickwrap checkbox → agree → app; first-chat popup → "Got it"', browser('needs a session with TERMS_GATE_ENABLED=1 — walk on beta before activation')],
    ],
  },
  {
    slug: 'install-an-app-from-marketplace',
    title: 'J7 Install an app (Documents / EDI Invoices) from the Marketplace',
    steps: [
      ['/marketplace page', page('/marketplace')],
      ['/connectors page', page('/connectors')],
      ['/plugins page', page('/plugins')],
      ['/documents page', page('/documents')],
      ['/edi-invoices page', page('/edi-invoices')],
      ['app catalog API wired + fail-closed', closedApi('GET', '/api/apps')],
      ['entitlements API wired + fail-closed', closedApi('GET', '/api/marketplace/entitlements')],
      ['install API wired + fail-closed', closedApi('POST', '/api/marketplace/install', {})],
      ['activate → Active card → Open lands on the app page; uninstalled deep-link shows install prompt', browser('needs an owner session — verify Documents/EDI gate before AND after installing (no grandfathering: all tenants start uninstalled)')],
    ],
  },
  {
    slug: 'manage-my-account',
    title: 'J8 Manage my account (Profile)',
    steps: [
      ['/profile page', page('/profile')],
      ['name/password save goes through Supabase auth directly (no AROS API seam)', browser('needs a session — save a name, verify the Saved note; wrong password shows the rule before any network call')],
    ],
  },
  {
    slug: 'get-unstuck',
    title: 'J5 Get unstuck',
    steps: [
      ['login page', page('/login')],
      ['reset-password page', page('/reset-password')],
      ['login API rejects empty submit cleanly', graceful('POST', '/api/login')],
      ['no raw error strings leaked in any response seen this walk', async () => {
        const leaks = [];
        for (const b of bodies) {
          for (const tok of RAW_ERROR_TOKENS) {
            if (b.text.includes(tok)) leaks.push(`${b.path} (${b.status}) contains "${tok}"`);
          }
        }
        if (leaks.length === 0) return { level: 'PASS', evidence: `${bodies.length} responses scanned clean` };
        return { level: 'FAIL', evidence: leaks.slice(0, 3).join(' · ') };
      }],
      ['failed submits preserve typed input; every failure has a one-tap recovery', browser('needs a session — walk failure rows from the spec')],
    ],
  },
];

async function main() {
  const results = [];
  for (const j of JOURNEYS) {
    if (ONLY && j.slug !== ONLY && j.slug !== 'preflight') continue;
    const steps = [];
    for (const [desc, fn] of j.steps) {
      let r;
      try { r = await fn(); } catch (e) { r = { level: 'FAIL', evidence: `walker error: ${e.message}` }; }
      steps.push({ desc, ...r });
    }
    const broken = steps.findIndex((s) => s.level === 'FAIL');
    results.push({ slug: j.slug, title: j.title, steps, verdict: broken === -1 ? 'WALKS CLEAN' : `BROKEN AT STEP ${broken + 1}` });
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ base: BASE, results }, null, 2));
  } else {
    console.log(`\nJourney walk against ${BASE}\n${'='.repeat(60)}`);
    for (const j of results) {
      console.log(`\n${j.title} — ${j.verdict}`);
      for (const s of j.steps) {
        const mark = { PASS: '  ✓', FAIL: '  ✗', WARN: '  !', 'NEEDS-BROWSER': '  ◌' }[s.level];
        console.log(`${mark} [${s.level}] ${s.desc} — ${s.evidence}`);
      }
    }
    const fails = results.flatMap((j) => j.steps).filter((s) => s.level === 'FAIL').length;
    const warns = results.flatMap((j) => j.steps).filter((s) => s.level === 'WARN').length;
    const manual = results.flatMap((j) => j.steps).filter((s) => s.level === 'NEEDS-BROWSER').length;
    console.log(`\n${'='.repeat(60)}\n${fails} FAIL · ${warns} WARN · ${manual} NEEDS-BROWSER (walk via journey-walker subagent)`);
  }
  process.exitCode = results.some((j) => j.steps.some((s) => s.level === 'FAIL')) ? 1 : 0;
}

main();
