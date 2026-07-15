-- AROS Store Snapshots (the warehouse layer)
-- 2026-07-15
-- Persists a per-tenant daily snapshot of the live store summary
-- (fetchStoreSummary output). Gives history — real changePercent, trends,
-- and cross-store rollups — so the self-serve connector path stops being
-- live-pull-only and converges with the internal warehouse-backed stores.
--
-- One row per tenant per business_date (upserted through the day; the final
-- write is that day's total). Written by the scheduled snapshotter in the
-- AROS server; read by getTenantStoreSummary (changePercent) and the dashboard.

CREATE TABLE IF NOT EXISTS public.store_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connector_id uuid REFERENCES public.tenant_connectors(id) ON DELETE SET NULL,
  business_date date NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  revenue numeric NOT NULL DEFAULT 0,
  transactions integer NOT NULL DEFAULT 0,
  low_stock_count integer NOT NULL DEFAULT 0,
  low_stock_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  partial boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_snapshots_unique_day UNIQUE (tenant_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_store_snapshots_tenant_date
  ON public.store_snapshots(tenant_id, business_date DESC);

-- Service-role only: written/read by the AROS server on behalf of tenants.
ALTER TABLE public.store_snapshots ENABLE ROW LEVEL SECURITY;
