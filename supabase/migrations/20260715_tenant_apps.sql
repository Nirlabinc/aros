-- ═══════════════════════════════════════════════════════════════════════════
-- DRAFT — do not apply until design PR approved
-- (shreai docs/projects/APP-FACTORY-TENANT-SUBSTRATE.md, branch
--  feat/tenant-app-substrate). Rebase onto latest main + prod catchup
-- before applying; launch.sh never runs migrations — staged apply only.
-- ═══════════════════════════════════════════════════════════════════════════
-- AROS Tenant Apps Registry — App Factory Phase 2
-- 2026-07-15
--
-- Per-tenant GENERATED apps (built by the software factory), hosted on
-- *.apps.aros.live. Mirrors the conventions of 20260424_multi_tenant.sql:
--   * IF NOT EXISTS everywhere (safe to re-run)
--   * public.touch_updated_at() for updated_at
--   * RLS via public.get_owned_tenant_ids(auth.uid()) + tenant_members
--     (identical member/admin split to marketplace_app_entitlements)
--
-- Two tables:
--   tenant_apps  — the registry (one row per generated app per tenant)
--   app_events   — append-only lifecycle audit (INSERT-only, service-role)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. tenant_apps ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  description text,
  -- Container image in the tailnet registry (aros-vps:5476),
  -- e.g. 'apps/acme-shift-planner'. Version = the exact promoted tag;
  -- beta/preview tags are tracked in app_events, not here.
  image_ref text,
  image_version text,
  status text NOT NULL DEFAULT 'draft',
  -- Postgres schema that holds ALL of this app's data. Generated apps get
  -- USAGE on this schema only — never on platform tables in public.
  db_schema text NOT NULL,
  -- Host label under apps.aros.live; also the container-name suffix
  -- (app-<subdomain>) that nginx resolves dynamically.
  subdomain text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  promoted_at timestamptz,
  retired_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_apps_status_check
    CHECK (status IN ('draft', 'preview', 'live', 'retired')),
  -- DNS-safe label, 3–40 chars, no leading/trailing hyphen
  CONSTRAINT tenant_apps_slug_check
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  CONSTRAINT tenant_apps_subdomain_check
    CHECK (subdomain ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  -- Schema-per-app namespace: app_<8-hex>, derived from id at creation
  CONSTRAINT tenant_apps_db_schema_check
    CHECK (db_schema ~ '^app_[a-z0-9_]{4,48}$'),
  CONSTRAINT tenant_apps_unique_slug UNIQUE (tenant_id, slug),
  CONSTRAINT tenant_apps_unique_subdomain UNIQUE (subdomain),
  CONSTRAINT tenant_apps_unique_db_schema UNIQUE (db_schema)
);

CREATE INDEX IF NOT EXISTS idx_tenant_apps_tenant_status
  ON public.tenant_apps(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tenant_apps_subdomain
  ON public.tenant_apps(subdomain);

DROP TRIGGER IF EXISTS touch_tenant_apps ON public.tenant_apps;
CREATE TRIGGER touch_tenant_apps BEFORE UPDATE ON public.tenant_apps
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── 2. app_events — append-only lifecycle audit ────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.tenant_apps(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event text NOT NULL,
  from_status text,
  to_status text,
  actor uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type text NOT NULL DEFAULT 'user',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_events_event_check
    CHECK (event IN (
      'created', 'build_started', 'build_succeeded', 'build_failed',
      'preview_deployed', 'smoke_passed', 'smoke_failed',
      'promoted', 'rolled_back', 'retired', 'status_changed'
    )),
  CONSTRAINT app_events_actor_type_check
    CHECK (actor_type IN ('user', 'service', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_app_events_app
  ON public.app_events(app_id, created_at);
CREATE INDEX IF NOT EXISTS idx_app_events_tenant
  ON public.app_events(tenant_id, created_at);

-- Append-only: block UPDATE/DELETE at the trigger level (applies to
-- service_role too — RLS alone would not stop the service key).
CREATE OR REPLACE FUNCTION public.app_events_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS app_events_no_update ON public.app_events;
CREATE TRIGGER app_events_no_update
  BEFORE UPDATE OR DELETE ON public.app_events
  FOR EACH ROW EXECUTE FUNCTION public.app_events_append_only();

-- ── 3. Lifecycle transition guard + auto-audit ─────────────────────────────
-- Legal transitions: draft→preview→live→retired, preview→draft (rework),
-- draft/preview→retired (abandon). Transitions INTO or OUT OF 'live' are
-- reserved for the deploy pipeline (service_role) or direct operator SQL —
-- an owner clicking around the UI can never self-promote to prod.
-- Every status change is recorded in app_events automatically.
CREATE OR REPLACE FUNCTION public.tenant_apps_guard_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  is_service boolean :=
    COALESCE(auth.jwt() ->> 'role', '') = 'service_role' OR auth.uid() IS NULL;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'draft'   AND NEW.status IN ('preview', 'retired')) OR
    (OLD.status = 'preview' AND NEW.status IN ('live', 'draft', 'retired')) OR
    (OLD.status = 'live'    AND NEW.status = 'retired')
  ) THEN
    RAISE EXCEPTION 'illegal tenant_apps transition % -> %', OLD.status, NEW.status;
  END IF;

  IF (NEW.status = 'live' OR OLD.status = 'live') AND NOT is_service THEN
    RAISE EXCEPTION 'transition %% live requires the deploy pipeline (service role)';
  END IF;

  IF NEW.status = 'live'    THEN NEW.promoted_at = now(); END IF;
  IF NEW.status = 'retired' THEN NEW.retired_at  = now(); END IF;

  INSERT INTO public.app_events (app_id, tenant_id, event, from_status, to_status, actor, actor_type)
  VALUES (
    NEW.id, NEW.tenant_id, 'status_changed', OLD.status, NEW.status,
    auth.uid(), CASE WHEN is_service THEN 'service' ELSE 'user' END
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenant_apps_transition ON public.tenant_apps;
CREATE TRIGGER tenant_apps_transition
  BEFORE UPDATE OF status ON public.tenant_apps
  FOR EACH ROW EXECUTE FUNCTION public.tenant_apps_guard_transition();

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — identical member/admin split to marketplace_app_entitlements
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tenant_apps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_apps_select_member ON public.tenant_apps;
CREATE POLICY tenant_apps_select_member ON public.tenant_apps FOR SELECT
  USING (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

DROP POLICY IF EXISTS tenant_apps_write_admin ON public.tenant_apps;
CREATE POLICY tenant_apps_write_admin ON public.tenant_apps FOR ALL
  USING (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner','admin')
    )
  ) WITH CHECK (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner','admin')
    )
  );

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

-- Members can read their tenant's app history. There is deliberately NO
-- insert/update/delete policy for authenticated: writes come from the
-- transition trigger (SECURITY DEFINER) and the deploy pipeline
-- (service_role bypasses RLS) — same posture as tenant_connectors.
DROP POLICY IF EXISTS app_events_select_member ON public.app_events;
CREATE POLICY app_events_select_member ON public.app_events FOR SELECT
  USING (
    tenant_id IN (SELECT public.get_owned_tenant_ids(auth.uid()))
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- No DELETE grant on tenant_apps: apps are retired, never deleted (the
-- registry row is the anchor for db_schema + audit history).
GRANT SELECT, INSERT, UPDATE ON public.tenant_apps TO authenticated;
GRANT SELECT ON public.app_events TO authenticated;
