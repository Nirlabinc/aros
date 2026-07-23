import { describe, it, expect } from 'vitest';
import { fetchHubCatalog, selectCatalogSource, internalCatalogAuthorized } from '../hub-catalog.js';

const hubOk = { ok: true as const, apps: [{ id: 'documents' }], capabilities: [{ id: 'mib-pos-connector', kind: 'connector', status: 'live' }] };
const hubDown = { ok: false as const, apps: [], capabilities: [], error: 'timeout' };
const local = [{ id: 'documents' }, { id: 'edi-invoices' }];

describe('selectCatalogSource', () => {
  it('uses hub apps + capabilities when the hub call succeeds', () => {
    const s = selectCatalogSource(local, hubOk);
    expect(s.catalog_source).toBe('shre-hub');
    expect(s.apps).toEqual(hubOk.apps);
    expect(s.capabilities).toHaveLength(1);
  });

  it('falls back to local rows when the hub is down (roll-back safe)', () => {
    const s = selectCatalogSource(local, hubDown);
    expect(s.catalog_source).toBe('local');
    expect(s.apps).toEqual(local);
    expect(s.capabilities).toEqual([]);
  });

  it('treats an empty hub apps list as an upstream read-back failure and stays local', () => {
    const s = selectCatalogSource(local, { ...hubOk, apps: [] });
    expect(s.catalog_source).toBe('local');
    expect(s.apps).toEqual(local);
    // capabilities still usable — the registry half of the hub worked
    expect(s.capabilities).toHaveLength(1);
  });
});

describe('fetchHubCatalog', () => {
  it('returns not-configured without url/token (never throws)', async () => {
    expect((await fetchHubCatalog(undefined, undefined)).ok).toBe(false);
    expect((await fetchHubCatalog('http://x', undefined)).ok).toBe(false);
  });

  it('parses a hub catalog response', async () => {
    const fake = (async () => new Response(JSON.stringify({ apps: [{ id: 'a' }], capabilities: [{ id: 'c', kind: 'skill', status: 'live' }] }))) as unknown as typeof fetch;
    const r = await fetchHubCatalog('http://hub', 'tok', fake);
    expect(r.ok).toBe(true);
    expect(r.apps).toEqual([{ id: 'a' }]);
    expect(r.capabilities[0].id).toBe('c');
  });

  it('reports non-200s and network errors as honest failures', async () => {
    const err = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    expect((await fetchHubCatalog('http://hub', 'tok', err)).error).toContain('401');
    const boom = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect((await fetchHubCatalog('http://hub', 'tok', boom)).error).toContain('ECONNREFUSED');
  });
});

describe('internalCatalogAuthorized', () => {
  it('fails closed when no token is configured', () => {
    expect(internalCatalogAuthorized('Bearer x', undefined)).toBe('unconfigured');
  });

  it('rejects missing/wrong bearers and accepts the right one', () => {
    expect(internalCatalogAuthorized(undefined, 'secret')).toBe('unauthorized');
    expect(internalCatalogAuthorized('Bearer wrong', 'secret')).toBe('unauthorized');
    expect(internalCatalogAuthorized('Bearer secret', 'secret')).toBe('ok');
  });
});
