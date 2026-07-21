-- ── Golden-record integration (task #17): atomic claim_strong_key() ─────────
-- The concurrency guarantee that resolve.ts models in app logic, made real at
-- the DB. A single INSERT ... ON CONFLICT under the UNIQUE(tenant,type,keytype,
-- keyvalue) backstop means two racing ingests of the same UPC cannot both win —
-- one gets 'claimed', the other is told the existing owner and adopts it. If the
-- existing owner is merged_away, the key is reassigned (dead records shed keys).
-- Returns 'claimed' when this canonical now holds the key, else the existing
-- ACTIVE owner's canonical_id (text) to adopt. Mirrors GoldenStore.claimStrongKey.

CREATE OR REPLACE FUNCTION public.claim_strong_key(
  p_tenant uuid, p_entity_type text, p_key_type text, p_key_value text, p_canonical uuid
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_owner uuid;
  v_status text;
BEGIN
  INSERT INTO public.canonical_strong_key (tenant_id, entity_type, key_type, key_value, canonical_id)
  VALUES (p_tenant, p_entity_type, p_key_type, p_key_value, p_canonical)
  ON CONFLICT (tenant_id, entity_type, key_type, key_value) DO NOTHING;
  IF FOUND THEN
    RETURN 'claimed';                       -- we won the race / first to claim
  END IF;

  SELECT k.canonical_id, c.status INTO v_owner, v_status
  FROM public.canonical_strong_key k
  JOIN public.canonical_entity c ON c.id = k.canonical_id
  WHERE k.tenant_id = p_tenant AND k.entity_type = p_entity_type
    AND k.key_type = p_key_type AND k.key_value = p_key_value;

  IF v_owner = p_canonical THEN
    RETURN 'claimed';                       -- already ours
  END IF;
  IF v_status = 'active' THEN
    RETURN v_owner::text;                    -- live owner → caller adopts it
  END IF;

  -- dead (merged_away) owner → reassign the key to the claimant.
  UPDATE public.canonical_strong_key
  SET canonical_id = p_canonical
  WHERE tenant_id = p_tenant AND entity_type = p_entity_type
    AND key_type = p_key_type AND key_value = p_key_value;
  RETURN 'claimed';
END;
$$;

COMMENT ON FUNCTION public.claim_strong_key IS
  'Atomic strong-key claim for golden-record resolution (task #17). Race-safe via the canonical_strong_key UNIQUE backstop; reassigns keys off merged_away owners. Called by src/golden/store.ts.';
