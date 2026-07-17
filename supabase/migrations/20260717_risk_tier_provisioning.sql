-- Risk tiers for the capability plane.
--
-- Every provisioned resource (skill/tool/agent/...) carries a normalized
-- risk tier matching the platform-wide ladder:
--   read           - no side effects outside the platform
--   reversible     - in-platform writes that can be undone
--   approval_gated - external or hard-to-undo side effects; human approval
--   sensitive      - credentials/payments/destructive; always approval
--
-- Policy invariant: FAIL CLOSED. A resource with no declared tier and no
-- provably read-only capability set lands on approval_gated.

-- ── tenant_resources.risk_tier ────────────────────────────────────────

ALTER TABLE public.tenant_resources
  ADD COLUMN IF NOT EXISTS risk_tier text NOT NULL DEFAULT 'approval_gated';

ALTER TABLE public.tenant_resources DROP CONSTRAINT IF EXISTS tenant_resources_risk_tier_check;
ALTER TABLE public.tenant_resources ADD CONSTRAINT tenant_resources_risk_tier_check
  CHECK (risk_tier IN ('read','reversible','approval_gated','sensitive'));

ALTER TABLE public.tenant_resources
  ADD COLUMN IF NOT EXISTS requires_approval boolean
  GENERATED ALWAYS AS (risk_tier IN ('approval_gated','sensitive')) STORED;

-- ── Tier derivation helper (deterministic, zero-LLM) ─────────────────
-- A capability set is read-only when every entry ends in '.read' or is a
-- read-shaped verb. Anything else fails closed.

CREATE OR REPLACE FUNCTION public.derive_risk_tier(p_capabilities text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_capabilities IS NULL OR cardinality(p_capabilities) = 0 THEN 'approval_gated'
    WHEN NOT EXISTS (
      SELECT 1 FROM unnest(p_capabilities) c
      WHERE NOT (c LIKE '%.read' OR c LIKE '%.query' OR c LIKE 'data.query' OR c LIKE '%.list' OR c LIKE '%.get')
    ) THEN 'read'
    ELSE 'approval_gated'
  END;
$$;

-- ── Backfill existing resources ──────────────────────────────────────
-- Read-only capability sets relax to 'read'; everything else keeps the
-- fail-closed default from the column addition.

UPDATE public.tenant_resources
  SET risk_tier = public.derive_risk_tier(capabilities)
  WHERE risk_tier = 'approval_gated';

-- ── apply_provisioning_manifest: carry tiers through activation ──────
-- Same signature; resource specs may now declare "risk_tier". Absent or
-- invalid declarations derive from capabilities (fail closed).

CREATE OR REPLACE FUNCTION public.apply_provisioning_manifest(
  p_tenant_id uuid,
  p_source_kind text,
  p_source_id text,
  p_manifest_key text,
  p_activate boolean,
  p_actor uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  manifest public.provisioning_manifests%ROWTYPE;
  spec jsonb;
  resource_uuid uuid;
  inserted_count integer;
  affected integer := 0;
  spec_tier text;
BEGIN
  SELECT * INTO manifest FROM public.provisioning_manifests
    WHERE key = p_manifest_key AND active = true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'provisioning manifest not found: %', p_manifest_key USING ERRCODE = 'P0002'; END IF;
  IF manifest.source_kind <> p_source_kind THEN RAISE EXCEPTION 'manifest source kind mismatch'; END IF;

  IF p_activate THEN
    FOR spec IN SELECT value FROM jsonb_array_elements(manifest.resources)
    LOOP
      IF COALESCE(spec->>'kind','') NOT IN ('channel','pos','app','agent','skill','tool','model')
        OR COALESCE(spec->>'name','') = '' THEN
        RAISE EXCEPTION 'invalid resource in manifest %', p_manifest_key;
      END IF;
      -- Declared tier wins when valid; otherwise derive fail-closed.
      spec_tier := spec->>'risk_tier';
      IF spec_tier IS NULL OR spec_tier NOT IN ('read','reversible','approval_gated','sensitive') THEN
        spec_tier := public.derive_risk_tier(
          ARRAY(SELECT jsonb_array_elements_text(COALESCE(spec->'capabilities','[]'::jsonb)))
        );
      END IF;
      INSERT INTO public.tenant_resources
        (tenant_id,kind,provider,name,status,config,capabilities,risk_tier,created_by)
      VALUES
        (p_tenant_id,spec->>'kind',NULLIF(spec->>'provider',''),spec->>'name','active',
         COALESCE(spec->'config','{}'::jsonb),
         ARRAY(SELECT jsonb_array_elements_text(COALESCE(spec->'capabilities','[]'::jsonb))),
         spec_tier,p_actor)
      ON CONFLICT (tenant_id,kind,name) DO NOTHING
      RETURNING id INTO resource_uuid;
      GET DIAGNOSTICS inserted_count = ROW_COUNT;
      IF inserted_count = 1 THEN
        INSERT INTO public.provisioned_resources(resource_id,created_by_manifest)
          VALUES(resource_uuid,p_manifest_key) ON CONFLICT DO NOTHING;
      ELSE
        SELECT id INTO resource_uuid FROM public.tenant_resources
          WHERE tenant_id=p_tenant_id AND kind=spec->>'kind' AND name=spec->>'name';
        -- Adopt only resources explicitly marked as system-managed. A manual
        -- resource with the same name is bound for visibility but never
        -- disabled by lifecycle reconciliation.
        INSERT INTO public.provisioned_resources(resource_id,created_by_manifest)
          SELECT resource_uuid,p_manifest_key FROM public.tenant_resources r
          WHERE r.id=resource_uuid AND COALESCE((r.config->>'systemManaged')::boolean,false)
          ON CONFLICT DO NOTHING;
        -- System-managed resources track the manifest's tier on reactivation.
        UPDATE public.tenant_resources r SET risk_tier=spec_tier
          WHERE r.id=resource_uuid
            AND COALESCE((r.config->>'systemManaged')::boolean,false)
            AND EXISTS(SELECT 1 FROM public.provisioned_resources p WHERE p.resource_id=r.id);
      END IF;
      INSERT INTO public.tenant_resource_bindings
        (tenant_id,source_kind,source_id,manifest_key,resource_id,active,detached_at)
      VALUES(p_tenant_id,p_source_kind,p_source_id,p_manifest_key,resource_uuid,true,NULL)
      ON CONFLICT (tenant_id,source_kind,source_id,resource_id) DO UPDATE
        SET active=true,detached_at=NULL,manifest_key=EXCLUDED.manifest_key;
      -- A previously provisioned resource can safely reactivate.
      UPDATE public.tenant_resources r SET status='active',updated_at=now()
        WHERE r.id=resource_uuid AND EXISTS(SELECT 1 FROM public.provisioned_resources p WHERE p.resource_id=r.id);
      affected := affected + 1;
    END LOOP;
  ELSE
    UPDATE public.tenant_resource_bindings SET active=false,detached_at=now()
      WHERE tenant_id=p_tenant_id AND source_kind=p_source_kind AND source_id=p_source_id AND active=true;
    GET DIAGNOSTICS affected = ROW_COUNT;
    UPDATE public.tenant_resources r SET status='inactive',updated_at=now()
      WHERE r.tenant_id=p_tenant_id
        AND EXISTS(SELECT 1 FROM public.provisioned_resources p WHERE p.resource_id=r.id)
        AND EXISTS(SELECT 1 FROM public.tenant_resource_bindings b WHERE b.resource_id=r.id AND b.source_kind=p_source_kind AND b.source_id=p_source_id)
        AND NOT EXISTS(SELECT 1 FROM public.tenant_resource_bindings b WHERE b.resource_id=r.id AND b.active=true);
  END IF;
  RETURN jsonb_build_object('ok',true,'active',p_activate,'affected',affected,'manifest',p_manifest_key);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_provisioning_manifest(uuid,text,text,text,boolean,uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.apply_provisioning_manifest(uuid,text,text,text,boolean,uuid) TO service_role;

-- ── Declare explicit tiers on the seeded connector manifests ─────────
-- All current connector resources are read-shaped; declaring them keeps
-- future manifest edits honest (a new write-capability resource without a
-- declared tier will fail closed to approval_gated).

UPDATE public.provisioning_manifests SET resources = '[
 {"kind":"skill","provider":"aros","name":"Daily Sales Summary","capabilities":["pos.sales.read"],"risk_tier":"read"},
 {"kind":"skill","provider":"aros","name":"Inventory Watch","capabilities":["pos.inventory.read"],"risk_tier":"read"},
 {"kind":"tool","provider":"rapidrms","name":"RapidRMS Data","capabilities":["pos.sales.read","pos.inventory.read"],"risk_tier":"read"},
 {"kind":"agent","provider":"shreai","name":"Store Operations Agent","capabilities":["operations.read","health.read"],"risk_tier":"read"}
]'::jsonb, updated_at = now() WHERE key = 'connector.rapidrms-api.v1';

UPDATE public.provisioning_manifests SET resources = '[
 {"kind":"skill","provider":"aros","name":"Daily Sales Summary","capabilities":["pos.sales.read"],"risk_tier":"read"},
 {"kind":"tool","provider":"verifone","name":"Commander Data","capabilities":["pos.sales.read","pos.inventory.read"],"risk_tier":"read"},
 {"kind":"agent","provider":"shreai","name":"Store Operations Agent","capabilities":["operations.read","health.read"],"risk_tier":"read"}
]'::jsonb, updated_at = now() WHERE key = 'connector.verifone-commander.v1';

UPDATE public.provisioning_manifests SET resources = '[
 {"kind":"skill","provider":"aros","name":"Retail Data Query","capabilities":["data.query"],"risk_tier":"read"},
 {"kind":"tool","provider":"azure-sql","name":"Azure SQL Data","capabilities":["data.query","agent.context"],"risk_tier":"approval_gated"}
]'::jsonb, updated_at = now() WHERE key = 'connector.azure-db.v1';
