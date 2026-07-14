-- AROS Marketplace App Entitlements
-- 2026-06-16

CREATE TABLE IF NOT EXISTS public.marketplace_app_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  app_key text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'marketplace',
  enabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  role_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  service_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_app_entitlements_status_check
    CHECK (status IN ('active', 'disabled', 'pending', 'error')),
  CONSTRAINT marketplace_app_entitlements_unique_app
    UNIQUE (tenant_id, app_key)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_entitlements_tenant_status
  ON public.marketplace_app_entitlements(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_marketplace_entitlements_app_key
  ON public.marketplace_app_entitlements(app_key);

DROP TRIGGER IF EXISTS touch_marketplace_app_entitlements ON public.marketplace_app_entitlements;
CREATE TRIGGER touch_marketplace_app_entitlements
  BEFORE UPDATE ON public.marketplace_app_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.marketplace_app_entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_entitlements_select_member ON public.marketplace_app_entitlements;
CREATE POLICY marketplace_entitlements_select_member
  ON public.marketplace_app_entitlements FOR SELECT
  USING (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

DROP POLICY IF EXISTS marketplace_entitlements_write_admin ON public.marketplace_app_entitlements;
CREATE POLICY marketplace_entitlements_write_admin
  ON public.marketplace_app_entitlements FOR ALL
  USING (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner','admin')
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner','admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_app_entitlements TO authenticated;
