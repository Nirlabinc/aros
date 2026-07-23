-- Automation fire ledger — the at-most-once send authority for the sentinel
-- (mission: docs/missions/aros-automation-rules.md, slice 1b; send-path review
-- H1/H2). The sentinel CLAIMS a row here BEFORE it sends, via
--   INSERT ... ON CONFLICT DO NOTHING RETURNING id
-- so a returned id = this process/replica owns the send; no row = a prior pass
-- or another replica already sent it (skip, do not send). The UNIQUE key MUST
-- equal the coalesce/dedupe key (tenant_id, invoice_no, channel, destination),
-- making duplicate texts impossible across overlapping passes AND replicas.
--
-- Intentionally AT-MOST-ONCE: a claim whose send then throws is recorded
-- status='send_failed' and NEVER retried (the row still blocks a refire) — for
-- owner-facing SMS one rare missed alert beats a duplicate storm.
CREATE TABLE IF NOT EXISTS public.automation_fires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_id uuid,
  invoice_no text NOT NULL,
  channel text NOT NULL,
  destination text NOT NULL,
  message_id text,
  status text NOT NULL DEFAULT 'sent',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, invoice_no, channel, destination)
);

-- Window scan (already-fired pre-filter + daily counter) is keyed by tenant+time.
CREATE INDEX IF NOT EXISTS automation_fires_tenant_created
  ON public.automation_fires(tenant_id, created_at);

ALTER TABLE public.automation_fires ENABLE ROW LEVEL SECURITY;

-- Service-role only: no RLS policies and no grants to authenticated, so only
-- the platform server (service role) claims/reads fires — the same posture as
-- event_subscriptions writes. This is an internal delivery ledger, not a
-- user-facing table.
