-- Production catch-up for projects that have the legacy AROS schema but never
-- received the repository migrations through 2026-07-14. Apply this entire file
-- once in the Supabase SQL editor before deploying the matching application code.
-- It is additive/idempotent and contains no real-tenant seed data.

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL UNIQUE,
  business_name text, pos_system text, source text DEFAULT 'contact_form', utm_campaign text,
  notes text, status text DEFAULT 'new', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads(created_at DESC);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, email text NOT NULL,
  full_name text, avatar_url text, is_superadmin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, is_superadmin)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
          COALESCE((NEW.raw_user_meta_data->>'role') = 'superadmin', false))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created' AND tgrelid = 'auth.users'::regclass) THEN
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;
INSERT INTO public.profiles (id, email, full_name, is_superadmin)
SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', email),
       COALESCE((raw_user_meta_data->>'role') = 'superadmin', false)
FROM auth.users ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS status text;
UPDATE public.tenants SET timezone = 'America/New_York' WHERE timezone IS NULL;
UPDATE public.tenants SET currency = 'USD' WHERE currency IS NULL;
UPDATE public.tenants SET status = 'active' WHERE status IS NULL;
ALTER TABLE public.tenants ALTER COLUMN timezone SET DEFAULT 'America/New_York';
ALTER TABLE public.tenants ALTER COLUMN currency SET DEFAULT 'USD';
ALTER TABLE public.tenants ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE public.tenant_members ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
ALTER TABLE public.tenant_members ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.tenant_members ADD COLUMN IF NOT EXISTS joined_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_members_one_default
  ON public.tenant_members(user_id) WHERE is_default = true;
INSERT INTO public.tenant_members (tenant_id, user_id, role, is_default, status)
SELECT id, owner_id, 'owner', false, 'active' FROM public.tenants WHERE owner_id IS NOT NULL
ON CONFLICT (tenant_id, user_id) DO NOTHING;
WITH users_needing_default AS (
  SELECT user_id FROM public.tenant_members WHERE status = 'active' GROUP BY user_id
  HAVING COUNT(*) FILTER (WHERE is_default) = 0
), first_membership AS (
  SELECT DISTINCT ON (tm.user_id) tm.id FROM public.tenant_members tm
  JOIN users_needing_default u USING (user_id) WHERE tm.status = 'active'
  ORDER BY tm.user_id, tm.joined_at, tm.id
)
UPDATE public.tenant_members SET is_default = true WHERE id IN (SELECT id FROM first_membership);

CREATE TABLE IF NOT EXISTS public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL, slug text, address text, timezone text NOT NULL DEFAULT 'America/New_York',
  currency text NOT NULL DEFAULT 'USD', status text NOT NULL DEFAULT 'active', pos_provider text,
  pos_client_id text, pos_db_name text, pos_external_id text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_stores_tenant ON public.stores(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stores_pos ON public.stores(pos_provider, pos_client_id);

CREATE TABLE IF NOT EXISTS public.pos_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connector_id text NOT NULL, config jsonb NOT NULL DEFAULT '{}'::jsonb, vault_ref text, status text DEFAULT 'pending',
  last_sync_at timestamptz, error text, created_at timestamptz DEFAULT now()
);
ALTER TABLE public.pos_connections ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pos_connections_store ON public.pos_connections(store_id);

CREATE OR REPLACE FUNCTION public.get_owned_tenant_ids(uid uuid) RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$ SELECT id FROM public.tenants WHERE owner_id = uid $$;
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'touch_profiles' AND tgrelid = 'public.profiles'::regclass) THEN
    CREATE TRIGGER touch_profiles BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'touch_stores' AND tgrelid = 'public.stores'::regclass) THEN
    CREATE TRIGGER touch_stores BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.pos_sales_daily (
  id bigserial PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE, business_date date NOT NULL, department text,
  total_sales numeric(14,2) NOT NULL DEFAULT 0, total_transactions integer NOT NULL DEFAULT 0,
  total_units numeric(14,2) NOT NULL DEFAULT 0, avg_ticket numeric(12,2) NOT NULL DEFAULT 0,
  total_tax numeric(14,2) NOT NULL DEFAULT 0, total_discounts numeric(14,2) NOT NULL DEFAULT 0,
  total_voids numeric(14,2) NOT NULL DEFAULT 0, total_refunds numeric(14,2) NOT NULL DEFAULT 0,
  source_provider text, source_sync_at timestamptz, raw jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_sales_daily_store_date_department
  ON public.pos_sales_daily(store_id, business_date, COALESCE(department, ''));
CREATE INDEX IF NOT EXISTS idx_pos_sales_daily_tenant_date ON public.pos_sales_daily(tenant_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_pos_sales_daily_store_date ON public.pos_sales_daily(store_id, business_date DESC);
CREATE TABLE IF NOT EXISTS public.pos_transactions (
  id bigserial PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE, business_date date NOT NULL,
  transaction_time timestamptz NOT NULL, external_id text NOT NULL, cashier_id text, cashier_name text,
  register_id text, subtotal numeric(14,2), tax numeric(14,2), discount numeric(14,2), total numeric(14,2) NOT NULL,
  tender text, item_count integer, voided boolean NOT NULL DEFAULT false, refunded boolean NOT NULL DEFAULT false,
  raw jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (store_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_pos_tx_store_time ON public.pos_transactions(store_id, transaction_time DESC);
CREATE INDEX IF NOT EXISTS idx_pos_tx_tenant_date ON public.pos_transactions(tenant_id, business_date DESC);
CREATE TABLE IF NOT EXISTS public.pos_inventory_snapshot (
  id bigserial PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE, sku text NOT NULL, name text, department text,
  units_on_hand numeric(14,2), unit_cost numeric(12,4), unit_price numeric(12,4), inventory_value numeric(14,2),
  snapshot_at timestamptz NOT NULL DEFAULT now(), raw jsonb, UNIQUE (store_id, sku, snapshot_at)
);
CREATE INDEX IF NOT EXISTS idx_pos_inv_store_sku ON public.pos_inventory_snapshot(store_id, sku);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'touch_pos_sales_daily' AND tgrelid = 'public.pos_sales_daily'::regclass) THEN
    CREATE TRIGGER touch_pos_sales_daily BEFORE UPDATE ON public.pos_sales_daily FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.stripe_billing_events (
  event_id text PRIMARY KEY, type text, payload jsonb, processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.marketplace_app_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  app_key text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','pending','error')),
  source text NOT NULL DEFAULT 'marketplace', enabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enabled_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz, role_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  service_config jsonb NOT NULL DEFAULT '{}'::jsonb, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, app_key)
);
CREATE INDEX IF NOT EXISTS idx_marketplace_entitlements_tenant_status ON public.marketplace_app_entitlements(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_marketplace_entitlements_app_key ON public.marketplace_app_entitlements(app_key);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'touch_marketplace_app_entitlements' AND tgrelid = 'public.marketplace_app_entitlements'::regclass) THEN
    CREATE TRIGGER touch_marketplace_app_entitlements BEFORE UPDATE ON public.marketplace_app_entitlements
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tenant_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('rapidrms-api','verifone-commander','azure-db')), name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb, credentials_encrypted text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','disconnected','error')),
  last_tested timestamptz, last_error text, created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_tenant_connectors_tenant ON public.tenant_connectors(tenant_id, status);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sales_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_inventory_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_app_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_connectors ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_select_self') THEN
    CREATE POLICY profiles_select_self ON public.profiles FOR SELECT USING (id = auth.uid() OR is_superadmin);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_update_self') THEN
    CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stores' AND policyname='stores_select_member') THEN
    CREATE POLICY stores_select_member ON public.stores FOR SELECT USING (tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid())) OR tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stores' AND policyname='stores_write_admin') THEN
    CREATE POLICY stores_write_admin ON public.stores FOR ALL USING (tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid())) OR tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=auth.uid() AND role IN ('owner','admin'))) WITH CHECK (tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid())) OR tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=auth.uid() AND role IN ('owner','admin')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pos_sales_daily' AND policyname='psd_select_member') THEN
    CREATE POLICY psd_select_member ON public.pos_sales_daily FOR SELECT USING (tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid())) OR tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pos_transactions' AND policyname='ptx_select_member') THEN
    CREATE POLICY ptx_select_member ON public.pos_transactions FOR SELECT USING (tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid())) OR tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pos_inventory_snapshot' AND policyname='pis_select_member') THEN
    CREATE POLICY pis_select_member ON public.pos_inventory_snapshot FOR SELECT USING (tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid())) OR tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='marketplace_app_entitlements' AND policyname='marketplace_entitlements_select_member') THEN
    CREATE POLICY marketplace_entitlements_select_member ON public.marketplace_app_entitlements FOR SELECT USING (tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid())) OR tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=auth.uid() AND status='active'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='marketplace_app_entitlements' AND policyname='marketplace_entitlements_write_admin') THEN
    CREATE POLICY marketplace_entitlements_write_admin ON public.marketplace_app_entitlements FOR ALL USING (tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid())) OR tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=auth.uid() AND status='active' AND role IN ('owner','admin'))) WITH CHECK (tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid())) OR tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=auth.uid() AND status='active' AND role IN ('owner','admin')));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.stores, public.marketplace_app_entitlements TO authenticated;
GRANT SELECT ON public.pos_sales_daily, public.pos_transactions, public.pos_inventory_snapshot TO authenticated;
