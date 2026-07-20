import { describe, expect, it, beforeEach } from 'vitest';
import { resolveCanonical, type GoldenStore, type ResolveInput, type StrongKeyRow } from '../golden/resolve.js';

// In-memory GoldenStore that ENFORCES the strong-key UNIQUE backstop (the real
// DB constraint), scopes by tenant + entity_type, and lets us drive the
// conflict + concurrency paths the review flagged as untested.
class FakeStore implements GoldenStore {
  aliases = new Map<string, string>();                 // "tenant|type|sys|id" -> canonicalId
  canon = new Map<string, { tenantId: string; entityType: string; status: string }>();
  keys = new Map<string, string>();                    // "tenant|type|keyType|keyValue" -> canonicalId (UNIQUE)
  candidates: Array<{ canonicalId: string; candidateIds: string[] }> = [];
  seq = 0;
  private k(...p: string[]) { return p.join('|'); }

  async findAliasCanonicalId(i: { tenantId: string; entityType: string; sourceSystem: string; sourceId: string }) {
    return this.aliases.get(this.k(i.tenantId, i.entityType, i.sourceSystem, i.sourceId)) ?? null;
  }
  async lookupStrongKeys(i: { tenantId: string; entityType: string; keys: Record<string, string> }) {
    const out: StrongKeyRow[] = [];
    for (const [kt, kv] of Object.entries(i.keys)) {
      const cid = this.keys.get(this.k(i.tenantId, i.entityType, kt, kv));
      if (cid && this.canon.get(cid)?.status === 'active') out.push({ keyType: kt, keyValue: kv, canonicalId: cid });
    }
    return out;
  }
  async canonicalKeys(canonicalId: string) {
    const out: Record<string, string> = {};
    for (const [key, cid] of this.keys) if (cid === canonicalId) {
      const [, , kt, kv] = key.split('|'); out[kt] = kv;
    }
    return out;
  }
  async createCanonical(i: { tenantId: string; entityType: string }) {
    const id = `c${++this.seq}`;
    this.canon.set(id, { tenantId: i.tenantId, entityType: i.entityType, status: 'active' });
    return id;
  }
  async claimStrongKey(i: { tenantId: string; entityType: string; keyType: string; keyValue: string; canonicalId: string }) {
    const key = this.k(i.tenantId, i.entityType, i.keyType, i.keyValue);
    const owner = this.keys.get(key);
    if (owner && owner !== i.canonicalId) {
      if (this.canon.get(owner)?.status === 'active') return owner;   // live owner → adopt
      // dead owner → reassign the key (dead records shed their strong keys)
    }
    this.keys.set(key, i.canonicalId);
    return 'claimed' as const;
  }
  async markMergedAway(loserId: string, winnerId: string) {
    const c = this.canon.get(loserId); if (c) c.status = 'merged_away';
  }
  async writeAlias(i: { tenantId: string; entityType: string; sourceSystem: string; sourceId: string; canonicalId: string }) {
    this.aliases.set(this.k(i.tenantId, i.entityType, i.sourceSystem, i.sourceId), i.canonicalId);
  }
  async flagCandidate(i: { canonicalId: string; candidateIds: string[] }) {
    this.candidates.push({ canonicalId: i.canonicalId, candidateIds: i.candidateIds });
  }
}

const base = (over: Partial<ResolveInput> = {}): ResolveInput => ({
  tenantId: 't1', entityType: 'product', sourceSystem: 'rapidrms', sourceId: 's1',
  matchKeys: { upc: '012345678905' }, ...over,
});

let store: FakeStore;
beforeEach(() => { store = new FakeStore(); });

describe('resolveCanonical — golden-record decision table', () => {
  it('alias hit short-circuits (a resolved source never re-creates)', async () => {
    const first = await resolveCanonical(store, base());
    const again = await resolveCanonical(store, base());
    expect(again.outcome).toBe('alias_hit');
    expect(again.canonicalId).toBe(first.canonicalId);
  });

  it('single non-conflicting strong match auto-links and claims new keys', async () => {
    const seed = await resolveCanonical(store, base({ sourceId: 'existing' }));
    const incoming = await resolveCanonical(store, base({ sourceSystem: 'pos', sourceId: 'new', matchKeys: { upc: '012345678905', sku: 'SKU1' } }));
    expect(incoming.outcome).toBe('auto_linked');
    expect(incoming.canonicalId).toBe(seed.canonicalId);
    // the new sku is now claimed for that canonical
    expect((await store.canonicalKeys(seed.canonicalId)).sku).toBe('SKU1');
  });

  it('CONFLICTING strong key does NOT auto-merge — flags instead (review fix)', async () => {
    // seed {upc:X, sku:Z}; incoming {upc:X, sku:Y} shares upc but conflicts on sku
    const seed = await resolveCanonical(store, base({ sourceId: 'a', matchKeys: { upc: 'X', sku: 'Z' } }));
    const incoming = await resolveCanonical(store, base({ sourceId: 'b', matchKeys: { upc: 'X', sku: 'Y' } }));
    expect(incoming.outcome).toBe('created_flagged');
    expect(incoming.candidateIds).toEqual([seed.canonicalId]);
    expect(incoming.canonicalId).not.toBe(seed.canonicalId);
  });

  it('no strong key → clean create, never links on weak data', async () => {
    const r = await resolveCanonical(store, base({ matchKeys: { name: 'Widget' } }));
    const r2 = await resolveCanonical(store, base({ sourceId: 's2', matchKeys: { name: 'Widget' } }));
    expect(r.outcome).toBe('created_clean');
    expect(r2.canonicalId).not.toBe(r.canonicalId);
  });

  it('multiple distinct canonicals → fresh id + flag, no auto-merge, no key poison (review fix)', async () => {
    const a = await resolveCanonical(store, base({ sourceId: 'a', matchKeys: { upc: 'X' } }));
    const b = await resolveCanonical(store, base({ sourceId: 'b', matchKeys: { sku: 'Y' } }));
    const c = await resolveCanonical(store, base({ sourceId: 'c', matchKeys: { upc: 'X', sku: 'Y' } }));
    expect(c.outcome).toBe('created_flagged');
    expect(c.candidateIds).toEqual(expect.arrayContaining([a.canonicalId, b.canonicalId]));
    // the flagged record claimed NO strong keys, so a later true dup of X still auto-links to a
    const d = await resolveCanonical(store, base({ sourceId: 'd', sourceSystem: 'pos', matchKeys: { upc: 'X' } }));
    expect(d.outcome).toBe('auto_linked');
    expect(d.canonicalId).toBe(a.canonicalId);
  });

  it('concurrent create of the same UPC converges to ONE canonical (review fix)', async () => {
    // two racers, neither has an alias yet, same strong key
    const [r1, r2] = await Promise.all([
      resolveCanonical(store, base({ sourceSystem: 'rapidrms', sourceId: 'x' })),
      resolveCanonical(store, base({ sourceSystem: 'pos', sourceId: 'y' })),
    ]);
    // exactly one active canonical holds the UPC; both resolved to it
    expect(r1.canonicalId).toBe(r2.canonicalId);
    const active = [...store.canon.values()].filter((c) => c.status === 'active').length;
    expect(active).toBe(1);
  });

  it('merged-away canonicals are not matched (no resurrection)', async () => {
    const seed = await resolveCanonical(store, base({ sourceId: 'a', matchKeys: { upc: 'X' } }));
    await store.markMergedAway(seed.canonicalId, 'other');
    const after = await resolveCanonical(store, base({ sourceId: 'b', sourceSystem: 'pos', matchKeys: { upc: 'X' } }));
    // dead record not matched → the key is still owned in the table, so claim
    // adopts... but status filter means lookup returns nothing → fresh create path.
    expect(after.canonicalId).not.toBe(seed.canonicalId);
  });

  it('location entity dedups on geohash', async () => {
    const seed = await resolveCanonical(store, base({ entityType: 'location', matchKeys: { geohash: 'dn5bp' }, sourceId: 'la' }));
    const dup = await resolveCanonical(store, base({ entityType: 'location', matchKeys: { geohash: 'dn5bp' }, sourceSystem: 'manual', sourceId: 'lb' }));
    expect(dup.outcome).toBe('auto_linked');
    expect(dup.canonicalId).toBe(seed.canonicalId);
  });

  it('tenant isolation — same UPC in a different tenant is a different canonical', async () => {
    const t1 = await resolveCanonical(store, base({ tenantId: 't1', matchKeys: { upc: 'SHARED' } }));
    const t2 = await resolveCanonical(store, base({ tenantId: 't2', matchKeys: { upc: 'SHARED' } }));
    expect(t2.canonicalId).not.toBe(t1.canonicalId);
  });
});
