-- Manifest-driven resource provisioning for connector/app entitlements.
-- Resource attachment and detachment happen in one database transaction.

ALTER TABLE public.tenant_resources DROP CONSTRAINT IF EXISTS tenant_resources_kind_check;
ALTER TABLE public.tenant_resources ADD CONSTRAINT tenant_resources_kind_check
  CHECK (kind IN ('channel','pos','app','agent','skill','tool','model'));

CREATE TABLE IF NOT EXISTS public.provisioning_manifests (
  key text PRIMARY KEY,
  source_kind text NOT NULL CHECK (source_kind IN ('connector','app','plugin')),
  source_key text NOT NULL,
  version text NOT NULL,
  resources jsonb NOT NULL CHECK (jsonb_typeof(resources) = 'array'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_key)
);

CREATE TABLE IF NOT EXISTS public.tenant_resource_bindings (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('connector','app','plugin')),
  source_id text NOT NULL,
  manifest_key text NOT NULL REFERENCES public.provisioning_manifests(key),
  resource_id uuid NOT NULL REFERENCES public.tenant_resources(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  attached_at timestamptz NOT NULL DEFAULT now(),
  detached_at timestamptz,
  PRIMARY KEY (tenant_id, source_kind, source_id, resource_id)
);

-- Marks resources created by this system. Pre-existing/manual resources are
-- bindable but are never lifecycle-managed or disabled by a manifest.
CREATE TABLE IF NOT EXISTS public.provisioned_resources (
  resource_id uuid PRIMARY KEY REFERENCES public.tenant_resources(id) ON DELETE CASCADE,
  created_by_manifest text NOT NULL REFERENCES public.provisioning_manifests(key),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resource_bindings_active
  ON public.tenant_resource_bindings(tenant_id, resource_id, active);

ALTER TABLE public.provisioning_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_resource_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provisioned_resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY resource_bindings_select_member ON public.tenant_resource_bindings FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active')
);
GRANT SELECT ON public.tenant_resource_bindings TO authenticated;

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
      INSERT INTO public.tenant_resources
        (tenant_id,kind,provider,name,status,config,capabilities,created_by)
      VALUES
        (p_tenant_id,spec->>'kind',NULLIF(spec->>'provider',''),spec->>'name','active',
         COALESCE(spec->'config','{}'::jsonb),
         ARRAY(SELECT jsonb_array_elements_text(COALESCE(spec->'capabilities','[]'::jsonb))),p_actor)
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

INSERT INTO public.provisioning_manifests(key,source_kind,source_key,version,resources) VALUES
('connector.rapidrms-api.v1','connector','rapidrms-api','1.0.0','[
 {"kind":"skill","provider":"aros","name":"Daily Sales Summary","capabilities":["pos.sales.read"]},
 {"kind":"skill","provider":"aros","name":"Inventory Watch","capabilities":["pos.inventory.read"]},
 {"kind":"tool","provider":"rapidrms","name":"RapidRMS Data","capabilities":["pos.sales.read","pos.inventory.read"]},
 {"kind":"agent","provider":"shreai","name":"Store Operations Agent","capabilities":["operations.read","health.read"]}
]'::jsonb),
('connector.verifone-commander.v1','connector','verifone-commander','1.0.0','[
 {"kind":"skill","provider":"aros","name":"Daily Sales Summary","capabilities":["pos.sales.read"]},
 {"kind":"tool","provider":"verifone","name":"Commander Data","capabilities":["pos.sales.read","pos.inventory.read"]},
 {"kind":"agent","provider":"shreai","name":"Store Operations Agent","capabilities":["operations.read","health.read"]}
]'::jsonb),
('connector.azure-db.v1','connector','azure-db','1.0.0','[
 {"kind":"skill","provider":"aros","name":"Retail Data Query","capabilities":["data.query"]},
 {"kind":"tool","provider":"azure-sql","name":"Azure SQL Data","capabilities":["data.query","agent.context"]}
]'::jsonb)
ON CONFLICT (key) DO UPDATE SET version=EXCLUDED.version,resources=EXCLUDED.resources,active=true,updated_at=now();

-- The original setup migration seeded Daily Sales Summary for every tenant.
-- Mark that exact platform seed as managed, backfill bindings for connectors
-- already connected before this migration, then remove the false entitlement
-- from tenants that have no active binding. Store Operations Agent remains a
-- baseline resource because it also provides non-POS health capabilities.
UPDATE public.tenant_resources
  SET config = config || '{"systemManaged":true}'::jsonb
  WHERE kind='skill' AND provider='aros' AND name='Daily Sales Summary'
    AND config @> '{"version":"1.0.0"}'::jsonb;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT id,tenant_id,type,created_by FROM public.tenant_connectors WHERE status='connected'
  LOOP
    PERFORM public.apply_provisioning_manifest(
      c.tenant_id,'connector',c.id::text,
      CASE c.type
        WHEN 'rapidrms-api' THEN 'connector.rapidrms-api.v1'
        WHEN 'verifone-commander' THEN 'connector.verifone-commander.v1'
        WHEN 'azure-db' THEN 'connector.azure-db.v1'
      END,
      true,c.created_by
    ) WHERE c.type IN ('rapidrms-api','verifone-commander','azure-db');
  END LOOP;
END $$;

UPDATE public.tenant_resources r SET status='inactive',updated_at=now()
  WHERE r.kind='skill' AND r.provider='aros' AND r.name='Daily Sales Summary'
    AND COALESCE((r.config->>'systemManaged')::boolean,false)
    AND NOT EXISTS(SELECT 1 FROM public.tenant_resource_bindings b WHERE b.resource_id=r.id AND b.active=true);
