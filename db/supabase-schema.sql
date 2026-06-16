-- ============================================================================
-- AROS Platform — Supabase Schema
-- Run against a Supabase project's SQL editor to bootstrap the database.
-- Requires Supabase Auth (auth.users) to be available.
-- ============================================================================

-- Tenants (one per customer company)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  plan TEXT NOT NULL DEFAULT 'free',
  billing_status TEXT NOT NULL DEFAULT 'none',
  pos_system TEXT,
  store_count INTEGER DEFAULT 1,
  license_key TEXT UNIQUE,
  license_tier TEXT DEFAULT 'free',
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-generate slug from name if not provided
CREATE OR REPLACE FUNCTION generate_tenant_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug = lower(regexp_replace(NEW.name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 8);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_auto_slug
  BEFORE INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION generate_tenant_slug();

-- Tenant members (multi-user per tenant)
CREATE TABLE tenant_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active',
  invited_at TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- POS connections (per tenant)
CREATE TABLE pos_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  vault_ref TEXT,
  status TEXT DEFAULT 'pending',
  last_sync_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Edge relay registrations (per tenant)
CREATE TABLE edge_relays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  relay_id TEXT UNIQUE NOT NULL,
  machine_id TEXT NOT NULL,
  os TEXT,
  version TEXT,
  status TEXT DEFAULT 'registered',
  last_heartbeat TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Onboarding progress tracking
CREATE TABLE onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  step INTEGER NOT NULL DEFAULT 1,
  step_data JSONB DEFAULT '{}',
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

-- Audit log
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  resource TEXT,
  detail JSONB DEFAULT '{}',
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Marketplace app entitlements (per tenant)
CREATE TABLE marketplace_app_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'pending', 'error')),
  source TEXT NOT NULL DEFAULT 'marketplace',
  enabled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ,
  role_mapping JSONB NOT NULL DEFAULT '{}',
  service_config JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, app_key)
);

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_relays ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_app_entitlements ENABLE ROW LEVEL SECURITY;

-- Helper: SECURITY DEFINER function to break RLS recursion between
-- tenants ↔ tenant_members. Without this, tenant_member_access reads
-- tenant_members which reads tenants → infinite recursion (42P17).
CREATE OR REPLACE FUNCTION public.get_owned_tenant_ids(uid uuid)
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id FROM tenants WHERE owner_id = uid
$$;

-- Tenants: owner has full access
CREATE POLICY tenant_owner ON tenants
  FOR ALL USING (owner_id = auth.uid());

-- Tenants: members can read
CREATE POLICY tenant_member_access ON tenants
  FOR SELECT USING (
    id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

-- Tenant members: owner manages (uses SECURITY DEFINER to avoid recursion)
CREATE POLICY member_own_tenant ON tenant_members
  FOR ALL USING (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
  );

-- Tenant members: self-read
CREATE POLICY member_self ON tenant_members
  FOR SELECT USING (user_id = auth.uid());

-- POS connections: owner or member
CREATE POLICY pos_tenant ON pos_connections
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
    OR tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

-- Edge relays: owner or member
CREATE POLICY relay_tenant ON edge_relays
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
    OR tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

-- Onboarding: owner only
CREATE POLICY onboarding_tenant ON onboarding_progress
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
  );

-- Audit log: owner can read
CREATE POLICY audit_tenant ON audit_log
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
  );

-- Marketplace entitlements: members can read, owners/admins manage
CREATE POLICY marketplace_entitlements_select_member ON marketplace_app_entitlements
  FOR SELECT USING (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
    OR tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY marketplace_entitlements_write_admin ON marketplace_app_entitlements
  FOR ALL USING (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
    OR tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  ) WITH CHECK (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
    OR tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX idx_tenants_owner ON tenants(owner_id);
CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_members_user ON tenant_members(user_id);
CREATE INDEX idx_members_tenant ON tenant_members(tenant_id);
CREATE INDEX idx_pos_tenant ON pos_connections(tenant_id);
CREATE INDEX idx_relay_tenant ON edge_relays(tenant_id);
CREATE INDEX idx_audit_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_marketplace_entitlements_tenant_status ON marketplace_app_entitlements(tenant_id, status);
CREATE INDEX idx_marketplace_entitlements_app_key ON marketplace_app_entitlements(app_key);

-- ============================================================================
-- Triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER onboarding_updated
  BEFORE UPDATE ON onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER marketplace_app_entitlements_updated
  BEFORE UPDATE ON marketplace_app_entitlements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
