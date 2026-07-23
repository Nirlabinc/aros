-- Automation rules — registration layer (mission: docs/missions/aros-automation-rules.md,
-- slice 1a). Chat-registered event subscriptions and scheduled reports. INERT in
-- this slice: no sentinel reads these rows yet, nothing sends.
--
-- Duplicate protection layer 1 (insert-time): canonical rule fingerprint with a
-- UNIQUE (tenant_id, fingerprint) constraint — exact dupes are impossible at the
-- database level regardless of which surface created the rule.
CREATE TABLE IF NOT EXISTS public.event_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by uuid,
  created_via text NOT NULL DEFAULT 'chat' CHECK (created_via IN ('chat','ui','api')),
  kind text NOT NULL CHECK (kind IN ('event','schedule')),
  -- kind=event → trigger_type (e.g. 'transaction_voided'); kind=schedule → report_type.
  trigger_type text,
  report_type text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  -- A REFERENCE to a prefs-registered destination (notification_preferences),
  -- never a free-text number/address typed in chat (authority rail).
  destination_ref text NOT NULL,
  -- kind=schedule only: {freq:'daily'|'weekly', time:'HH:mm', tz}.
  cadence jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending_connector','suspended','disabled')),
  fingerprint text NOT NULL,
  -- Sentinel bookkeeping (slice 1b): watermark = activation timestamp — a
  -- newly-activated rule never fires on historical backlog.
  watermark timestamptz,
  last_checked timestamptz,
  last_fired timestamptz,
  fires_in_window int NOT NULL DEFAULT 0,
  window_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS event_subscriptions_tenant_status
  ON public.event_subscriptions(tenant_id, status);

ALTER TABLE public.event_subscriptions ENABLE ROW LEVEL SECURITY;

-- Tenant members can READ their workspace's rules (list is member-visible).
-- ALL writes go through the platform server with the service role so the
-- owner/admin gate, destination binding, caps, and fingerprint checks are
-- always enforced server-side — no client write path exists.
DROP POLICY IF EXISTS event_subscriptions_member_select ON public.event_subscriptions;
CREATE POLICY event_subscriptions_member_select ON public.event_subscriptions FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active')
);

GRANT SELECT ON public.event_subscriptions TO authenticated;
