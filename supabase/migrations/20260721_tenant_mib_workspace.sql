-- Per-tenant override for the tenant's MIB workspace id (Documents app scope).
-- Default behavior needs no rows here: the AROS↔MIB convention is that the
-- OIDC experience-routing bridge creates the MIB workspace with
-- id == the AROS tenant id, and resolveMibWorkspaceId falls back to that.
-- Set this column only when a tenant's MIB workspace deviates from the
-- convention (e.g. pre-existing MIB workspace adopted by an AROS tenant).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS mib_workspace_id uuid;
