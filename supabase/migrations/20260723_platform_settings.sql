-- Platform-wide operational settings — a tiny key/value store the server reads
-- at runtime. First use (mission: docs/missions/aros-automation-rules.md, slice
-- 1b): the automation sentinel's GLOBAL PAUSE row, so an operator can halt all
-- automation fires WITHOUT a deploy or process restart (contract "Pause rails").
-- The AUTOMATION_RULES=0 env switch remains the hard backstop.
--
-- Service-role only: no RLS policies are defined and no grants to authenticated,
-- so only the platform server (service role) can read/write these rows.
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Operator runbook — pause every automation fire (no deploy):
--   INSERT INTO public.platform_settings (key, value)
--   VALUES ('automation_paused', '{"paused": true, "reason": "incident #123"}')
--   ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
-- Resume:
--   UPDATE public.platform_settings
--   SET value = '{"paused": false}', updated_at = now()
--   WHERE key = 'automation_paused';
-- (Deleting the row also resumes — the sentinel treats a missing row as "not
-- paused".) The next sentinel pass (≤ AUTOMATION_SENTINEL_MIN) honors the change.
