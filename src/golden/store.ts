// Golden-record integration (task #17): the real Supabase-backed GoldenStore.
// Implements the resolve.ts port against the #108 tables + the claim_strong_key
// atomic function. This is the ONE shared resolution implementation — the
// business-profile/connectors work binds through resolveCanonical(store, ...)
// with this store, so there is a single canonical-entity system, not two.
// Mission: docs/missions/regulars-golden-records.md (integration increment).

import { createSupabaseAdmin } from '../supabase.js';
import type { GoldenStore, StrongKeyRow } from './resolve.js';

export function createGoldenStore(): GoldenStore {
  const db = () => createSupabaseAdmin();
  return {
    async findAliasCanonicalId({ tenantId, entityType, sourceSystem, sourceId }) {
      const { data } = await db().from('entity_alias').select('canonical_id')
        .eq('tenant_id', tenantId).eq('entity_type', entityType)
        .eq('source_system', sourceSystem).eq('source_id', sourceId).maybeSingle();
      return (data?.canonical_id as string | undefined) ?? null;
    },

    async lookupStrongKeys({ tenantId, entityType, keys }) {
      const entries = Object.entries(keys);
      if (entries.length === 0) return [];
      // Match exact (key_type,key_value) pairs; then keep only rows whose
      // canonical is ACTIVE (merged_away records must not be matched).
      const orFilter = entries.map(([k, v]) => `and(key_type.eq.${k},key_value.eq.${v})`).join(',');
      const { data: rows, error } = await db().from('canonical_strong_key')
        .select('key_type, key_value, canonical_id')
        .eq('tenant_id', tenantId).eq('entity_type', entityType).or(orFilter);
      if (error) throw new Error(`lookupStrongKeys: ${error.message}`);
      if (!rows || rows.length === 0) return [];
      const ids = [...new Set(rows.map((r) => r.canonical_id as string))];
      const { data: active } = await db().from('canonical_entity')
        .select('id').in('id', ids).eq('status', 'active');
      const activeSet = new Set((active ?? []).map((a) => a.id as string));
      return rows
        .filter((r) => activeSet.has(r.canonical_id as string))
        .map((r): StrongKeyRow => ({ keyType: r.key_type as string, keyValue: r.key_value as string, canonicalId: r.canonical_id as string }));
    },

    async canonicalKeys(canonicalId) {
      const { data } = await db().from('canonical_strong_key')
        .select('key_type, key_value').eq('canonical_id', canonicalId);
      const out: Record<string, string> = {};
      for (const r of data ?? []) out[r.key_type as string] = r.key_value as string;
      return out;
    },

    async createCanonical({ tenantId, entityType, displayName, matchKeys }) {
      const { data, error } = await db().from('canonical_entity')
        .insert({ tenant_id: tenantId, entity_type: entityType, display_name: displayName ?? null, match_keys: matchKeys })
        .select('id').single();
      if (error || !data) throw new Error(`createCanonical: ${error?.message ?? 'no id'}`);
      return data.id as string;
    },

    async claimStrongKey({ tenantId, entityType, keyType, keyValue, canonicalId }) {
      const { data, error } = await db().rpc('claim_strong_key', {
        p_tenant: tenantId, p_entity_type: entityType, p_key_type: keyType, p_key_value: keyValue, p_canonical: canonicalId,
      });
      if (error) throw new Error(`claimStrongKey: ${error.message}`);
      return data as 'claimed' | string;
    },

    async markMergedAway(loserId, winnerId) {
      await db().from('canonical_entity').update({ status: 'merged_away', merged_into: winnerId }).eq('id', loserId);
    },

    async writeAlias({ tenantId, entityType, sourceSystem, sourceId, canonicalId }) {
      // Idempotent — the alias UNIQUE means a re-run is a no-op, not a dup.
      await db().from('entity_alias').upsert(
        { tenant_id: tenantId, entity_type: entityType, source_system: sourceSystem, source_id: sourceId, canonical_id: canonicalId },
        { onConflict: 'tenant_id,entity_type,source_system,source_id', ignoreDuplicates: true },
      );
    },

    async flagCandidate({ tenantId, entityType, canonicalId, candidateIds }) {
      await db().from('merge_candidate').insert({
        tenant_id: tenantId, entity_type: entityType, canonical_id: canonicalId, candidate_ids: candidateIds, status: 'open',
      });
    },
  };
}
