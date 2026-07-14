-- AROS Store Connectors
-- 2026-07-14
-- Per-tenant store data connectors (RapidRMS API, Verifone Commander, Azure SQL).
-- Credentials are stored AES-256-GCM encrypted (server-side key), never plain text.

CREATE TABLE IF NOT EXISTS public.tenant_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials_encrypted text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  last_tested timestamptz,
  last_error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_connectors_type_check
    CHECK (type IN ('rapidrms-api', 'verifone-commander', 'azure-db')),
  CONSTRAINT tenant_connectors_status_check
    CHECK (status IN ('pending', 'connected', 'disconnected', 'error')),
  CONSTRAINT tenant_connectors_unique_name
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tenant_connectors_tenant
  ON public.tenant_connectors(tenant_id, status);

-- Service-role access only: the AROS server reads/writes on behalf of
-- authenticated tenant members. No direct client access to credential blobs.
ALTER TABLE public.tenant_connectors ENABLE ROW LEVEL SECURITY;
