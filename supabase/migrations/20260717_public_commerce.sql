-- ── Regulars Phase 1: customer-safe public commerce surface ────────────────
-- Backs /api/public/businesses/{slug}/* (customer MCP gateway).
-- SENSITIVE-COLUMN RULE (mission contract regulars-phase1): nothing customer-
-- facing may expose unit_cost, exact units_on_hand, inventory_value, margins,
-- or customer PII. public_products_v below is the ONLY sanctioned read path
-- for customer product data.

-- ── public_promotions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.public_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE, -- null = all locations
  title text NOT NULL,
  description text,
  kind text NOT NULL DEFAULT 'offer',            -- offer | bundle | punch | reward
  sponsored boolean NOT NULL DEFAULT false,      -- set by ranking engine only; merchants never write this column directly
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'active',         -- draft | active | ended
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_public_promotions_tenant_active
  ON public.public_promotions(tenant_id, status, starts_at, ends_at);

ALTER TABLE public.public_promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pp_select_member ON public.public_promotions;
CREATE POLICY pp_select_member ON public.public_promotions FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()));
GRANT SELECT ON public.public_promotions TO authenticated;
-- Customer-surface reads go through the service role in the API layer; no anon grants.

DROP TRIGGER IF EXISTS touch_public_promotions ON public.public_promotions;
CREATE TRIGGER touch_public_promotions BEFORE UPDATE ON public.public_promotions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── public_cart_drafts (draft-only in Phase 1: no payment execution) ───────
CREATE TABLE IF NOT EXISTS public.public_cart_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  items jsonb NOT NULL,                          -- [{sku, name, qty, unit_price}] priced server-side
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',          -- draft | checkout_draft | expired
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_public_cart_drafts_tenant
  ON public.public_cart_drafts(tenant_id, created_at DESC);
-- Supports the expired-draft purge (bounds unbounded growth from the public POST /cart path).
CREATE INDEX IF NOT EXISTS idx_public_cart_drafts_expiry
  ON public.public_cart_drafts(expires_at);

ALTER TABLE public.public_cart_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pcd_select_member ON public.public_cart_drafts;
CREATE POLICY pcd_select_member ON public.public_cart_drafts FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()));
GRANT SELECT ON public.public_cart_drafts TO authenticated;

-- ── public_products_v: THE customer-safe product projection ────────────────
-- Latest snapshot row per (store, sku); availability quantized; cost columns
-- and exact quantities EXCLUDED BY CONSTRUCTION.
-- security_invoker=true: the view runs with the CALLER's privileges, so the
-- RLS on pos_inventory_snapshot still applies — it does NOT become an
-- RLS-bypassing definer view auto-readable by anon via PostgREST. The API
-- layer reads it through the service role; anon/authenticated get no grant.
CREATE OR REPLACE VIEW public.public_products_v
WITH (security_invoker = true) AS
SELECT DISTINCT ON (s.store_id, s.sku)
  s.tenant_id,
  s.store_id,
  s.sku,
  s.name,
  s.department,
  s.unit_price,
  CASE
    WHEN s.units_on_hand IS NULL THEN 'unknown'
    WHEN s.units_on_hand <= 0 THEN 'unavailable'
    WHEN s.units_on_hand <= 5 THEN 'low_stock'
    ELSE 'in_stock'
  END AS availability,
  s.snapshot_at AS as_of
FROM public.pos_inventory_snapshot s
ORDER BY s.store_id, s.sku, s.snapshot_at DESC;

COMMENT ON VIEW public.public_products_v IS
  'Customer-safe product projection. Excludes unit_cost, exact units_on_hand, inventory_value, raw. Availability quantized to unknown/unavailable/low_stock/in_stock. Serves /api/public/businesses/{slug}/products.';

-- Belt-and-suspenders: this view (and the two public tables) must never be
-- reachable via the anon/authenticated PostgREST keys. Only the service role
-- (used inside the API layer, behind rate limiting + the response envelope)
-- may read them. Revoke Supabase's default auto-grants explicitly.
REVOKE ALL ON public.public_products_v FROM anon, authenticated;
REVOKE ALL ON public.public_promotions FROM anon, authenticated;
REVOKE ALL ON public.public_cart_drafts FROM anon, authenticated;

-- Bound the public POST /cart path: purge expired drafts. Called best-effort
-- by the API on each cart insert; also safe to run from a scheduled job.
CREATE OR REPLACE FUNCTION public.purge_expired_cart_drafts()
RETURNS integer LANGUAGE sql AS $$
  WITH deleted AS (
    DELETE FROM public.public_cart_drafts WHERE expires_at < now() RETURNING 1
  ) SELECT count(*)::integer FROM deleted;
$$;
