// Regulars golden records (task #17) — canonical resolution.
// resolveCanonical() turns a (source_system, source_id) + strong match keys
// into a stable canonical_id. Resolution goes THROUGH the canonical_strong_key
// table whose UNIQUE(tenant, entity_type, key_type, key_value) constraint is
// the atomic dedup backstop: two racing ingests of the same UPC cannot both
// create a golden record. Guarantees: alias registry checked first (a resolved
// source never re-creates); a single non-conflicting strong match auto-links;
// zero-match creates fresh (race-safe via key claim); multiple distinct
// canonicals OR a conflicting key value flags for the review queue — NEVER
// auto-merges on ambiguity. Plan §10 · mission: regulars-golden-records.md.

export type EntityType = 'product' | 'location' | 'customer';

export interface ResolveInput {
  tenantId: string;
  entityType: EntityType;
  sourceSystem: string;
  sourceId: string;
  /** Strong deterministic keys. Products: {upc|gtin|sku}. Locations: {geohash|address_norm}. */
  matchKeys: Record<string, string>;
  displayName?: string;
}

export interface ResolveResult {
  canonicalId: string;
  outcome: 'alias_hit' | 'auto_linked' | 'created_flagged' | 'created_clean';
  candidateIds?: string[];
}

export interface StrongKeyRow { keyType: string; keyValue: string; canonicalId: string; }

/** DB port. The real impl backs these with the service-role client; the
 *  `claimStrongKey` upsert is where DB-level uniqueness enforces atomicity. */
export interface GoldenStore {
  findAliasCanonicalId(i: { tenantId: string; entityType: string; sourceSystem: string; sourceId: string }): Promise<string | null>;
  /** Active-canonical strong-key rows matching any (keyType,keyValue) in `keys`. */
  lookupStrongKeys(i: { tenantId: string; entityType: string; keys: Record<string, string> }): Promise<StrongKeyRow[]>;
  /** The strong keys currently held by one canonical, as {keyType: keyValue}. */
  canonicalKeys(canonicalId: string): Promise<Record<string, string>>;
  createCanonical(i: { tenantId: string; entityType: string; displayName?: string; matchKeys: Record<string, string> }): Promise<string>;
  /** Insert (tenant,type,keyType,keyValue)->canonicalId. Returns 'claimed' if this
   *  canonical won the key. If an ACTIVE canonical already holds it, returns that
   *  canonicalId (race/adopt). If the current owner is MERGED_AWAY, the key is
   *  reassigned to this canonical and 'claimed' is returned — dead records never
   *  keep strong keys, so resolution can't resurrect them. */
  claimStrongKey(i: { tenantId: string; entityType: string; keyType: string; keyValue: string; canonicalId: string }): Promise<'claimed' | string>;
  markMergedAway(loserId: string, winnerId: string): Promise<void>;
  writeAlias(i: { tenantId: string; entityType: string; sourceSystem: string; sourceId: string; canonicalId: string }): Promise<void>;
  flagCandidate(i: { tenantId: string; entityType: string; canonicalId: string; candidateIds: string[] }): Promise<void>;
}
// NOTE (review-queue increment): kept-separate suppression via `negative_pair`
// is NOT wired here — it compares two EXISTING canonicals and belongs in the
// merge/review flow, not resolve-time against a brand-new id.

const STRONG_KEYS: Record<EntityType, string[]> = {
  product: ['upc', 'gtin', 'sku'],
  location: ['geohash', 'address_norm'],
  customer: ['phone_hash', 'email_hash'],
};

function strongSubset(entityType: EntityType, keys: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  // Strong values must be non-empty strings; '0' is a valid value (truthy), '' is not.
  for (const k of STRONG_KEYS[entityType]) if (keys[k] !== undefined && keys[k] !== '') out[k] = keys[k];
  return out;
}

export async function resolveCanonical(store: GoldenStore, input: ResolveInput): Promise<ResolveResult> {
  const { tenantId, entityType, sourceSystem, sourceId } = input;

  // (1) Alias registry FIRST — a previously resolved source can never re-create.
  const existing = await store.findAliasCanonicalId({ tenantId, entityType, sourceSystem, sourceId });
  if (existing) return { canonicalId: existing, outcome: 'alias_hit' };

  const strong = strongSubset(entityType, input.matchKeys);
  const strongEntries = Object.entries(strong);

  // No strong key → cannot deterministically match; create clean (fuzzy later).
  if (strongEntries.length === 0) {
    const id = await store.createCanonical({ tenantId, entityType, displayName: input.displayName, matchKeys: input.matchKeys });
    await store.writeAlias({ tenantId, entityType, sourceSystem, sourceId, canonicalId: id });
    return { canonicalId: id, outcome: 'created_clean' };
  }

  // (2) Look the strong keys up in the backstop table.
  const rows = await store.lookupStrongKeys({ tenantId, entityType, keys: strong });
  const distinct = [...new Set(rows.map((r) => r.canonicalId))];

  // (3) Multiple existing canonicals claim these keys → genuine ambiguity.
  //     Fresh canonical WITHOUT strong keys (so it can't poison the key space),
  //     flag the candidates, never auto-merge them.
  if (distinct.length > 1) {
    const id = await store.createCanonical({ tenantId, entityType, displayName: input.displayName, matchKeys: input.matchKeys });
    await store.writeAlias({ tenantId, entityType, sourceSystem, sourceId, canonicalId: id });
    await store.flagCandidate({ tenantId, entityType, canonicalId: id, candidateIds: distinct });
    return { canonicalId: id, outcome: 'created_flagged', candidateIds: distinct };
  }

  // (4) Exactly one existing canonical — but only auto-link if NO strong key
  //     CONFLICTS (same key type, different value = probably a different entity).
  if (distinct.length === 1) {
    const canonicalId = distinct[0];
    const held = await store.canonicalKeys(canonicalId);
    const conflict = strongEntries.some(([kt, kv]) => held[kt] !== undefined && held[kt] !== kv);
    if (conflict) {
      const id = await store.createCanonical({ tenantId, entityType, displayName: input.displayName, matchKeys: input.matchKeys });
      await store.writeAlias({ tenantId, entityType, sourceSystem, sourceId, canonicalId: id });
      await store.flagCandidate({ tenantId, entityType, canonicalId: id, candidateIds: [canonicalId] });
      return { canonicalId: id, outcome: 'created_flagged', candidateIds: [canonicalId] };
    }
    // Non-conflicting: link, and claim any strong keys this canonical lacks.
    await store.writeAlias({ tenantId, entityType, sourceSystem, sourceId, canonicalId });
    for (const [kt, kv] of strongEntries) if (held[kt] === undefined) {
      await store.claimStrongKey({ tenantId, entityType, keyType: kt, keyValue: kv, canonicalId }).catch(() => {});
    }
    return { canonicalId, outcome: 'auto_linked' };
  }

  // (5) No existing match → create + claim keys. The claim is race-safe: if a
  //     concurrent ingest already created the canonical and won a key, adopt it.
  const fresh = await store.createCanonical({ tenantId, entityType, displayName: input.displayName, matchKeys: input.matchKeys });
  let winner = fresh;
  for (const [kt, kv] of strongEntries) {
    const res = await store.claimStrongKey({ tenantId, entityType, keyType: kt, keyValue: kv, canonicalId: winner });
    if (res !== 'claimed' && res !== winner) {
      // A racer already owns this key → adopt their canonical, retire our orphan.
      if (winner === fresh) await store.markMergedAway(fresh, res);
      winner = res;
    }
  }
  await store.writeAlias({ tenantId, entityType, sourceSystem, sourceId, canonicalId: winner });
  return { canonicalId: winner, outcome: winner === fresh ? 'created_clean' : 'auto_linked' };
}
