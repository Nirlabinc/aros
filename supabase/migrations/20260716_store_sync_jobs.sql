-- Resumable historical store-data ingestion.
CREATE TABLE IF NOT EXISTS public.store_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connector_id uuid NOT NULL REFERENCES public.tenant_connectors(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  to_date date NOT NULL,
  cursor_date date NOT NULL,
  chunk_days integer NOT NULL DEFAULT 7 CHECK (chunk_days BETWEEN 1 AND 31),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  days_synced integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_sync_jobs_date_order CHECK (from_date <= to_date)
);

CREATE INDEX IF NOT EXISTS idx_store_sync_jobs_tenant_created
  ON public.store_sync_jobs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_sync_jobs_resumable
  ON public.store_sync_jobs(status, updated_at)
  WHERE status IN ('queued','running');

ALTER TABLE public.store_sync_jobs ENABLE ROW LEVEL SECURITY;
