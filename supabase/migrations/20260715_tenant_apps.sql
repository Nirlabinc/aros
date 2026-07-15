-- ═══════════════════════════════════════════════════════════════════════════
-- AROS Tenant Apps Registry — App Factory Phase 2
-- 2026-07-15 (finalized; founder decisions DECIDED 2026-07-15 — see
-- shreai docs/projects/APP-FACTORY-TENANT-SUBSTRATE.md §6)
--
-- Staged apply only: rebase onto latest main + prod catchup before applying;
-- launch.sh never runs migrations.
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
--
-- Promote policy (DECIDED 2026-07-15), enforced by trigger below:
--   * draft → preview: AUTO — service_role only, and only after a
--     'smoke_passed' event exists for the app (build pipeline callback).
--   * preview → live: ALWAYS human-approved — executed by the deploy
--     pipeline (service_role) but REQUIRES metadata.approved_by = uuid of
--     the approving human, which is recorded as the actor in app_events.
--
-- Billing (DECIDED 2026-07-15): build credits (metered LLM spend) + monthly
-- per-app hosting fee; preview containers are free.
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
  -- Billing (DECIDED 2026-07-15): credits + hosting.
  --   hosting_fee_cents  — monthly per-app hosting fee, charged only while
  --                        status = 'live' (previews are free); 0 = not yet
  --                        priced / included in plan.
  --   build_credits_used — cumulative metered LLM spend (credits) consumed
  --                        by factory builds/rebuilds of this app.
  hosting_fee_cents integer NOT NULL DEFAULT 0,
  build_credits_used bigint NOT NULL DEFAULT 0,
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
  CONSTRAINT tenant_apps_hosting_fee_check CHECK (hosting_fee_cents >= 0),
  CONSTRAINT tenant_apps_build_credits_check CHECK (build_credits_used >= 0),
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
-- draft/preview→retired (abandon).
--
-- Promote policy (DECIDED 2026-07-15):
--   * draft → preview  — AUTO on smoke pass: only the deploy pipeline
--     (service_role) may perform it, and only after a 'smoke_passed'
--     app_events row exists for the app. No human in the loop by design —
--     preview carries no production traffic.
--   * preview → live   — ALWAYS human-approved: executed by the pipeline
--     (service_role) but NEW.metadata->>'approved_by' MUST carry the uuid of
--     the approving human; it is recorded as the actor of the 'promoted'
--     event. A tenant admin with a stolen anon-key session cannot
--     self-promote; a pipeline without an operator approval cannot either.
--   * live → retired   — deploy pipeline only (container teardown must
--     accompany the row change).
-- Every status change is recorded in app_events automatically.
CREATE OR REPLACE FUNCTION public.tenant_apps_guard_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  is_service boolean :=
    COALESCE(auth.jwt() ->> 'role', '') = 'service_role' OR auth.uid() IS NULL;
  approver uuid;
  evt text := 'status_changed';
  evt_actor uuid;
  evt_actor_type text;
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

  -- draft → preview: auto-promote, service_role only, gated on smoke pass.
  IF OLD.status = 'draft' AND NEW.status = 'preview' THEN
    IF NOT is_service THEN
      RAISE EXCEPTION 'draft -> preview is performed by the build pipeline (service role) on smoke pass';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.app_events
      WHERE app_id = NEW.id AND event = 'smoke_passed'
    ) THEN
      RAISE EXCEPTION 'draft -> preview requires a smoke_passed event (auto-promote on smoke pass only)';
    END IF;
  END IF;

  -- preview → live: pipeline executes, human approves — both are required.
  IF OLD.status = 'preview' AND NEW.status = 'live' THEN
    IF NOT is_service THEN
      RAISE EXCEPTION 'preview -> live is executed by the deploy pipeline (service role)';
    END IF;
    approver := NULLIF(NEW.metadata ->> 'approved_by', '')::uuid;
    IF approver IS NULL THEN
      RAISE EXCEPTION 'preview -> live requires a human approver (metadata.approved_by = auth.users uuid)';
    END IF;
    evt := 'promoted';
    evt_actor := approver;
    evt_actor_type := 'user';
  END IF;

  -- live → retired: pipeline only (teardown accompanies the row change).
  IF OLD.status = 'live' AND NEW.status = 'retired' AND NOT is_service THEN
    RAISE EXCEPTION 'live -> retired is executed by the deploy pipeline (service role)';
  END IF;

  IF NEW.status = 'live'    THEN NEW.promoted_at = now(); END IF;
  IF NEW.status = 'retired' THEN NEW.retired_at  = now(); evt := 'retired'; END IF;

  IF evt_actor_type IS NULL THEN
    evt_actor := auth.uid();
    evt_actor_type := CASE WHEN is_service THEN 'service' ELSE 'user' END;
  END IF;

  INSERT INTO public.app_events (app_id, tenant_id, event, from_status, to_status, actor, actor_type, detail)
  VALUES (
    NEW.id, NEW.tenant_id, evt, OLD.status, NEW.status, evt_actor, evt_actor_type,
    jsonb_strip_nulls(jsonb_build_object(
      'image_version', NEW.image_version,
      'approved_by', approver
    ))
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
