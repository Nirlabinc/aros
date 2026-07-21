-- Per-user, per-workspace notification preferences (event × channel).
-- Catalog and defaults live in code (src/notifications.ts); this table only
-- stores explicit choices, so new catalog entries get sane defaults without
-- backfill.
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  enabled boolean NOT NULL DEFAULT true,
  destination text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, event_type, channel)
);

CREATE INDEX IF NOT EXISTS notification_preferences_tenant_user
  ON public.notification_preferences(tenant_id, user_id);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_prefs_own_select ON public.notification_preferences;
CREATE POLICY notification_prefs_own_select ON public.notification_preferences FOR SELECT USING (
  user_id = auth.uid()
  AND tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active')
);

DROP POLICY IF EXISTS notification_prefs_own_write ON public.notification_preferences;
CREATE POLICY notification_prefs_own_write ON public.notification_preferences FOR ALL USING (
  user_id = auth.uid()
  AND tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active')
) WITH CHECK (
  user_id = auth.uid()
  AND tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
