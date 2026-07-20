-- Per-member store assignment — the membership model behind the role-bundle
-- data_scope levels (contracts/platform/role-bundle.v1: assigned_sites |
-- region | division | all). The bundle says HOW FAR a role sees; these rows
-- say WHICH stores that resolves to for one member.
--
-- Adoption gate (deliberate): a tenant with ZERO rows here has not adopted
-- site assignment — site-scoped bundles then see all tenant stores, so
-- nothing breaks for existing tenants. The moment a tenant assigns ANY
-- member, enforcement is strict for everyone in that tenant: a site-scoped
-- member with no assignment sees nothing (fail closed).

CREATE TABLE IF NOT EXISTS public.tenant_member_stores (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  connector_id uuid NOT NULL REFERENCES public.tenant_connectors(id) ON DELETE CASCADE,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_member_stores_tenant_user
  ON public.tenant_member_stores (tenant_id, user_id);

ALTER TABLE public.tenant_member_stores ENABLE ROW LEVEL SECURITY;

-- Members read their own tenant's assignments (mirrors stores_select_member).
CREATE POLICY member_stores_select_member ON public.tenant_member_stores FOR SELECT
  USING (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.tenant_members m
      WHERE m.tenant_id = tenant_member_stores.tenant_id
        AND m.user_id = auth.uid() AND m.status = 'active'
    )
  );

-- Only tenant owners/admins write assignments.
CREATE POLICY member_stores_write_admin ON public.tenant_member_stores FOR ALL
  USING (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.tenant_members m
      WHERE m.tenant_id = tenant_member_stores.tenant_id
        AND m.user_id = auth.uid() AND m.status = 'active'
        AND m.role IN ('owner', 'admin')
    )
  );

GRANT SELECT ON public.tenant_member_stores TO authenticated;
