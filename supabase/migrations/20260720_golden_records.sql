-- ── Regulars golden records (task #17): canonical IDs + alias registry ──────
-- Every core entity resolves to ONE canonical_id; the alias registry makes a
-- resolved duplicate impossible to re-create on future ingests. Deterministic
-- matches auto-link; ambiguous ones are flagged (merge_candidate), never
-- auto-merged. Merges are reversible ledger events. Plan §10. FOUNDATION only
-- — the ingest/API integration and review-queue are separate increments.

-- ── canonical_entity: the golden record ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.canonical_entity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- THE canonical id everything keys off
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,                        -- product | location | customer
  display_name text,
  match_keys jsonb NOT NULL DEFAULT '{}'::jsonb,    -- strong keys (upc/sku/gtin, geohash) used to dedup
  status text NOT NULL DEFAULT 'active',            -- active | merged_away
  merged_into uuid REFERENCES public.canonical_entity(id) ON DELETE SET NULL, -- set when this record was merged into another
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_canonical_entity_tenant_type
  ON public.canonical_entity(tenant_id, entity_type, status);

-- ── canonical_strong_key: the ATOMIC dedup backstop ────────────────────────
-- One row per strong key (upc/gtin/sku, geohash, phone_hash) held by a
-- canonical. The UNIQUE constraint is what makes dedup concurrency-safe:
-- two racing ingests of the same UPC cannot both win the insert, so they
-- cannot create two golden records. Resolution goes THROUGH this table, not
-- the jsonb match_keys (which is now display/audit only).
CREATE TABLE IF NOT EXISTS public.canonical_strong_key (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  key_type text NOT NULL,                          -- upc | gtin | sku | geohash | phone_hash | ...
  key_value text NOT NULL,
  canonical_id uuid NOT NULL REFERENCES public.canonical_entity(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, key_type, key_value) -- the backstop
);
CREATE INDEX IF NOT EXISTS idx_canonical_strong_key_canon
  ON public.canonical_strong_key(canonical_id);

-- ── entity_alias: (source_system, source_id) -> canonical_id ───────────────
-- The persistence that guarantees "a resolved duplicate never comes back":
-- every ingest checks here FIRST. UNIQUE on the source pair.
CREATE TABLE IF NOT EXISTS public.entity_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  source_system text NOT NULL,                      -- e.g. rapidrms, pos_snapshot, manual
  source_id text NOT NULL,
  canonical_id uuid NOT NULL REFERENCES public.canonical_entity(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, source_system, source_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_alias_canonical
  ON public.entity_alias(canonical_id);

-- ── merge_candidate: ambiguous matches awaiting human decision ─────────────
-- Zero or multiple strong matches -> a fresh canonical id + a candidate row
-- for the merchant/enterprise review queue. Never auto-merged.
CREATE TABLE IF NOT EXISTS public.merge_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  canonical_id uuid NOT NULL REFERENCES public.canonical_entity(id) ON DELETE CASCADE, -- the fresh record
  candidate_ids uuid[] NOT NULL DEFAULT '{}',       -- other canonical_ids that plausibly match
  confidence numeric(4,3),
  status text NOT NULL DEFAULT 'open',              -- open | merged | kept_separate
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text
);
CREATE INDEX IF NOT EXISTS idx_merge_candidate_open
  ON public.merge_candidate(tenant_id, entity_type, status);

-- ── negative_pair: kept-separate verdicts (so the queue never re-flags) ────
CREATE TABLE IF NOT EXISTS public.negative_pair (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  id_a uuid NOT NULL REFERENCES public.canonical_entity(id) ON DELETE CASCADE,
  id_b uuid NOT NULL REFERENCES public.canonical_entity(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Order-independent uniqueness ENFORCED: the CHECK forces callers to store
  -- the pair with id_a < id_b, so (A,B) and (B,A) collapse to one row.
  CONSTRAINT negative_pair_ordered CHECK (id_a < id_b),
  UNIQUE (tenant_id, entity_type, id_a, id_b)
);

-- ── merge_event: reversible ledger (un-merge supported) ────────────────────
CREATE TABLE IF NOT EXISTS public.merge_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  winner_id uuid NOT NULL REFERENCES public.canonical_entity(id) ON DELETE CASCADE,  -- surviving canonical
  loser_id uuid NOT NULL REFERENCES public.canonical_entity(id) ON DELETE CASCADE,   -- merged_away canonical
  action text NOT NULL,                             -- merge | unmerge
  by_actor text,
  aliases_moved jsonb,                              -- snapshot of aliases repointed, for reversal
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_merge_event_pair
  ON public.merge_event(tenant_id, winner_id, loser_id);

-- RLS: tenant-member reads; all writes go through the service role in the app
-- layer (like public_promotions). Enable + member-select on each.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['canonical_entity','entity_alias','merge_candidate','negative_pair','merge_event'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_sel_member ON public.%I', t, t);
    EXECUTE format($f$CREATE POLICY %I_sel_member ON public.%I FOR SELECT
      USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()))$f$, t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS touch_canonical_entity ON public.canonical_entity;
CREATE TRIGGER touch_canonical_entity BEFORE UPDATE ON public.canonical_entity
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
