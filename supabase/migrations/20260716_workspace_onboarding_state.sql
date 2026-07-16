-- Canonical cross-application onboarding state for AROS, MIB, and StorePulse.
CREATE TABLE IF NOT EXISTS public.workspace_onboarding_state (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version = 1),
  phase text NOT NULL DEFAULT 'identity_ready' CHECK (phase IN (
    'identity_ready','model_ready','store_connected','data_syncing','capabilities_provisioning','ready'
  )),
  model jsonb NOT NULL DEFAULT '{"status":"not_started","updatedAt":null}'::jsonb,
  store jsonb NOT NULL DEFAULT '{"status":"not_started","updatedAt":null}'::jsonb,
  sync jsonb NOT NULL DEFAULT '{"status":"not_started","updatedAt":null}'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '{"status":"not_started","updatedAt":null}'::jsonb,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_onboarding_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_onboarding_member_select ON public.workspace_onboarding_state;
CREATE POLICY workspace_onboarding_member_select ON public.workspace_onboarding_state FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=auth.uid() AND status='active')
);
DROP POLICY IF EXISTS workspace_onboarding_admin_write ON public.workspace_onboarding_state;
CREATE POLICY workspace_onboarding_admin_write ON public.workspace_onboarding_state FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=auth.uid() AND status='active' AND role IN ('owner','admin'))
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=auth.uid() AND status='active' AND role IN ('owner','admin'))
);
GRANT SELECT,INSERT,UPDATE ON public.workspace_onboarding_state TO authenticated;

INSERT INTO public.workspace_onboarding_state(
  tenant_id,phase,model,store,sync,capabilities,completed_at,updated_at
)
SELECT
  t.id,
  CASE WHEN t.onboarding_completed THEN 'ready' ELSE 'identity_ready' END,
  jsonb_build_object('status',CASE WHEN t.onboarding_completed THEN 'ready' ELSE 'not_started' END,'updatedAt',CASE WHEN t.onboarding_completed THEN now() ELSE NULL END),
  jsonb_build_object('status',CASE WHEN t.onboarding_completed THEN 'ready' ELSE 'not_started' END,'updatedAt',CASE WHEN t.onboarding_completed THEN now() ELSE NULL END),
  jsonb_build_object('status',CASE WHEN t.onboarding_completed THEN 'ready' ELSE 'not_started' END,'updatedAt',CASE WHEN t.onboarding_completed THEN now() ELSE NULL END),
  jsonb_build_object('status',CASE WHEN t.onboarding_completed THEN 'ready' ELSE 'not_started' END,'updatedAt',CASE WHEN t.onboarding_completed THEN now() ELSE NULL END),
  CASE WHEN t.onboarding_completed THEN now() ELSE NULL END,
  now()
FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_workspace_onboarding_component(
  p_tenant_id uuid,
  p_component text,
  p_status text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_error text DEFAULT NULL
) RETURNS public.workspace_onboarding_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result public.workspace_onboarding_state;
DECLARE value jsonb;
BEGIN
  IF p_component NOT IN ('model','store','sync','capabilities') THEN RAISE EXCEPTION 'invalid onboarding component'; END IF;
  IF p_status NOT IN ('not_started','pending','ready','error','skipped') THEN RAISE EXCEPTION 'invalid onboarding status'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_members WHERE tenant_id=p_tenant_id AND user_id=auth.uid() AND status='active' AND role IN ('owner','admin'))
    AND auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  INSERT INTO workspace_onboarding_state(tenant_id) VALUES(p_tenant_id) ON CONFLICT DO NOTHING;
  value := jsonb_build_object('status',p_status,'updatedAt',now(),'metadata',COALESCE(p_metadata,'{}'::jsonb),'error',p_error);
  EXECUTE format('UPDATE workspace_onboarding_state SET %I=$1,updated_at=now() WHERE tenant_id=$2',p_component) USING value,p_tenant_id;
  UPDATE workspace_onboarding_state SET
    phase=CASE
      WHEN model->>'status' NOT IN ('ready','skipped') THEN 'identity_ready'
      WHEN store->>'status' NOT IN ('ready','skipped') THEN 'model_ready'
      WHEN sync->>'status' = 'not_started' THEN 'store_connected'
      WHEN sync->>'status' NOT IN ('ready','skipped') THEN 'data_syncing'
      WHEN capabilities->>'status' NOT IN ('ready','skipped') THEN 'capabilities_provisioning'
      ELSE 'ready' END,
    completed_at=CASE WHEN model->>'status' IN ('ready','skipped') AND store->>'status' IN ('ready','skipped') AND sync->>'status' IN ('ready','skipped') AND capabilities->>'status' IN ('ready','skipped') THEN COALESCE(completed_at,now()) ELSE NULL END
  WHERE tenant_id=p_tenant_id RETURNING * INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.set_workspace_onboarding_component(uuid,text,text,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_onboarding_component(uuid,text,text,jsonb,text) TO authenticated,service_role;
