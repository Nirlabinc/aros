import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  TERMS_VERSION,
  PRIVACY_VERSION,
  AI_CHAT_DISCLOSURE_KEY,
  TERMS_REQUIRED_STATUS,
  TERMS_REQUIRED_CODE,
  isTermsGateEnabled,
} from '../constants';
import {
  createTermsModule,
  isTermsExemptPath,
  needsAcceptance,
  type TermsDbClient,
  type TermsAuthContext,
} from '../gate';

// ── Fakes ────────────────────────────────────────────────────────

function fakeReq(opts: {
  body?: unknown;
  bearer?: string;
  ip?: string;
  userAgent?: string;
} = {}): IncomingMessage {
  const payload = opts.body === undefined ? [] : [JSON.stringify(opts.body)];
  const req = Readable.from(payload) as unknown as IncomingMessage;
  req.headers = {
    ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
    ...(opts.userAgent ? { 'user-agent': opts.userAgent } : {}),
    ...(opts.ip ? { 'x-forwarded-for': opts.ip } : {}),
  };
  return req;
}

function fakeRes() {
  const state = { status: 0, body: null as any, ended: false };
  const res = {
    writeHead(status: number) { state.status = status; return res; },
    end(chunk?: string) { state.ended = true; if (chunk) state.body = JSON.parse(chunk); },
  } as unknown as ServerResponse;
  return { res, state };
}

type Rows = Record<string, Array<Record<string, unknown>>>;

function fakeDb(rows: Rows = {}) {
  const inserts: Rows = {};
  const upserts: Rows = {};
  let queries = 0;
  const client: TermsDbClient = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const q: any = {
        select() { return q; },
        eq(column: string, value: unknown) { filters.push([column, value]); return q; },
        limit() {
          queries += 1;
          const data = (rows[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data, error: null });
        },
        insert(row: Record<string, unknown>) {
          (inserts[table] ??= []).push(row);
          return Promise.resolve({ error: null });
        },
        upsert(row: Record<string, unknown>) {
          (upserts[table] ??= []).push(row);
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
  return { client, inserts, upserts, queryCount: () => queries };
}

const USER: TermsAuthContext = { userId: 'user-1', tenantId: 'tenant-1', role: 'owner' };

function makeModule(opts: {
  rows?: Rows;
  env?: Record<string, string>;
  auth?: TermsAuthContext | null;
} = {}) {
  const db = fakeDb(opts.rows);
  const audits: Array<Record<string, unknown>> = [];
  const module = createTermsModule({
    createClient: () => db.client,
    authenticate: async (req) =>
      req.headers.authorization?.startsWith('Bearer ') ? (opts.auth === undefined ? USER : opts.auth) : null,
    getClientIp: (req) => (req.headers['x-forwarded-for'] as string) || 'unknown',
    auditLog: async (entry) => { audits.push(entry); },
    env: opts.env ?? {},
    cacheTtlMs: 0, // no cross-assertion caching inside tests
  });
  return { module, db, audits };
}

// ── Pure helpers ────────────────────────────────────────────────

describe('isTermsGateEnabled', () => {
  it.each([undefined, '', '0', 'false', 'off'])('flag off for %j', (v) => {
    expect(isTermsGateEnabled({ TERMS_GATE_ENABLED: v as string })).toBe(false);
  });
  it.each(['1', 'true', 'TRUE', 'yes', 'on'])('flag on for %j', (v) => {
    expect(isTermsGateEnabled({ TERMS_GATE_ENABLED: v })).toBe(true);
  });
});

describe('isTermsExemptPath', () => {
  it.each([
    '/api/terms/status',
    '/api/terms/accept',
    '/api/disclosures/ack',
    '/api/login',
    '/api/signup',
    '/api/leads',
    '/api/branding/public',
    '/api/billing/webhook',
    '/api/auth/email-otp/verify-email',
    '/api/edge/devices',
    '/api/app-launch/consume',
  ])('exempts %s', (p) => expect(isTermsExemptPath(p)).toBe(true));

  it.each(['/api/connectors', '/api/store/summary', '/api/dashboard', '/api/marketplace/entitlements'])(
    'gates %s',
    (p) => expect(isTermsExemptPath(p)).toBe(false),
  );
});

describe('needsAcceptance (version-bump re-gating)', () => {
  it('requires acceptance when there is none', () => {
    expect(needsAcceptance(null)).toBe(true);
  });
  it('passes a current-version acceptance', () => {
    expect(needsAcceptance(TERMS_VERSION)).toBe(false);
  });
  it('re-gates when the version bumps', () => {
    expect(needsAcceptance('2025-01-01', TERMS_VERSION)).toBe(true);
  });
});

// ── enforceGate ─────────────────────────────────────────────────

describe('enforceGate', () => {
  it('is a strict no-op when the flag is off — no DB access, nothing written', async () => {
    const { module, db } = makeModule({ env: {} });
    const { res, state } = fakeRes();
    const blocked = await module.enforceGate(fakeReq({ bearer: 't' }), res, '/api/connectors');
    expect(blocked).toBe(false);
    expect(state.ended).toBe(false);
    expect(db.queryCount()).toBe(0);
  });

  it('does not gate unauthenticated requests (route 401s handle those)', async () => {
    const { module } = makeModule({ env: { TERMS_GATE_ENABLED: '1' } });
    const { res, state } = fakeRes();
    expect(await module.enforceGate(fakeReq(), res, '/api/connectors')).toBe(false);
    expect(state.ended).toBe(false);
  });

  it('does not gate exempt paths even when flagged on', async () => {
    const { module, db } = makeModule({ env: { TERMS_GATE_ENABLED: '1' } });
    const { res } = fakeRes();
    expect(await module.enforceGate(fakeReq({ bearer: 't' }), res, '/api/login')).toBe(false);
    expect(db.queryCount()).toBe(0);
  });

  it('blocks an authenticated user with no acceptance with the distinct 428 code', async () => {
    const { module } = makeModule({ env: { TERMS_GATE_ENABLED: '1' } });
    const { res, state } = fakeRes();
    const blocked = await module.enforceGate(fakeReq({ bearer: 't' }), res, '/api/connectors');
    expect(blocked).toBe(true);
    expect(state.status).toBe(TERMS_REQUIRED_STATUS);
    expect(state.body.code).toBe(TERMS_REQUIRED_CODE);
    expect(state.body.termsVersion).toBe(TERMS_VERSION);
  });

  it('passes an authenticated user with a current-version acceptance', async () => {
    const { module } = makeModule({
      env: { TERMS_GATE_ENABLED: '1' },
      rows: { terms_acceptances: [{ id: 'a', user_id: USER.userId, terms_version: TERMS_VERSION }] },
    });
    const { res, state } = fakeRes();
    expect(await module.enforceGate(fakeReq({ bearer: 't' }), res, '/api/connectors')).toBe(false);
    expect(state.ended).toBe(false);
  });

  it('re-gates a user whose acceptance is for an older version', async () => {
    const { module } = makeModule({
      env: { TERMS_GATE_ENABLED: '1' },
      rows: { terms_acceptances: [{ id: 'a', user_id: USER.userId, terms_version: '2025-01-01' }] },
    });
    const { res, state } = fakeRes();
    expect(await module.enforceGate(fakeReq({ bearer: 't' }), res, '/api/connectors')).toBe(true);
    expect(state.status).toBe(TERMS_REQUIRED_STATUS);
  });
});

// ── handleStatus ────────────────────────────────────────────────

describe('handleStatus', () => {
  it('reports flag + versions publicly without auth', async () => {
    const { module } = makeModule({ env: {} });
    const { res, state } = fakeRes();
    await module.handleStatus(fakeReq(), res);
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      gateEnabled: false,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      aiChatDisclosureKey: AI_CHAT_DISCLOSURE_KEY,
      accepted: null,
    });
  });

  it('reports the caller acceptance + disclosure state when authenticated', async () => {
    const { module } = makeModule({
      env: { TERMS_GATE_ENABLED: 'true' },
      rows: {
        terms_acceptances: [{ id: 'a', user_id: USER.userId, terms_version: '2025-01-01' }],
        user_disclosures: [],
      },
    });
    const { res, state } = fakeRes();
    await module.handleStatus(fakeReq({ bearer: 't' }), res);
    expect(state.body).toMatchObject({
      gateEnabled: true,
      accepted: false, // old version → re-gate
      previouslyAccepted: true, // drives the "what changed" copy
      aiDisclosureAcknowledged: false,
    });
  });
});

// ── handleAccept ────────────────────────────────────────────────

describe('handleAccept', () => {
  it('requires authentication', async () => {
    const { module } = makeModule();
    const { res, state } = fakeRes();
    await module.handleAccept(fakeReq({ body: { accepted: true } }), res);
    expect(state.status).toBe(401);
  });

  it('rejects anything but affirmative { accepted: true }', async () => {
    const { module, db } = makeModule();
    const { res, state } = fakeRes();
    await module.handleAccept(fakeReq({ bearer: 't', body: { accepted: 'yes' } }), res);
    expect(state.status).toBe(400);
    expect(db.inserts.terms_acceptances).toBeUndefined();
  });

  it('records acceptance with server-stamped ip / user_agent / timestamps and audits it', async () => {
    const { module, db, audits } = makeModule();
    const { res, state } = fakeRes();
    const before = Date.now();
    await module.handleAccept(
      fakeReq({
        bearer: 't',
        ip: '203.0.113.7',
        userAgent: 'vitest-agent',
        // client tries to forge evidence fields — they must be ignored
        body: { accepted: true, ip: '1.1.1.1', user_agent: 'forged', accepted_at: '1999-01-01T00:00:00Z' },
      }),
      res,
    );
    expect(state.status).toBe(200);
    const row = db.inserts.terms_acceptances?.[0];
    expect(row).toMatchObject({
      user_id: USER.userId,
      tenant_id: USER.tenantId,
      terms_version: TERMS_VERSION,
      privacy_version: PRIVACY_VERSION,
      ip: '203.0.113.7',
      user_agent: 'vitest-agent',
    });
    const acceptedAt = Date.parse(String(row?.accepted_at));
    expect(acceptedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(acceptedAt).toBeLessThanOrEqual(Date.now() + 1000);
    expect(audits[0]).toMatchObject({ action: 'terms.accepted', userId: USER.userId });
  });
});

// ── handleDisclosureAck ─────────────────────────────────────────

describe('handleDisclosureAck', () => {
  it('requires authentication', async () => {
    const { module } = makeModule();
    const { res, state } = fakeRes();
    await module.handleDisclosureAck(fakeReq({ body: { disclosureKey: AI_CHAT_DISCLOSURE_KEY } }), res);
    expect(state.status).toBe(401);
  });

  it('rejects unknown disclosure keys', async () => {
    const { module } = makeModule();
    const { res, state } = fakeRes();
    await module.handleDisclosureAck(fakeReq({ bearer: 't', body: { disclosureKey: 'nope' } }), res);
    expect(state.status).toBe(400);
  });

  it('records the ai-chat disclosure ack keyed by terms version', async () => {
    const { module, db, audits } = makeModule();
    const { res, state } = fakeRes();
    await module.handleDisclosureAck(
      fakeReq({ bearer: 't', body: { disclosureKey: AI_CHAT_DISCLOSURE_KEY } }),
      res,
    );
    expect(state.status).toBe(200);
    expect(db.upserts.user_disclosures?.[0]).toMatchObject({
      user_id: USER.userId,
      disclosure_key: AI_CHAT_DISCLOSURE_KEY,
      version: TERMS_VERSION,
    });
    expect(audits[0]).toMatchObject({ action: 'disclosure.acknowledged' });
  });
});
