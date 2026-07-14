-- Stripe webhook idempotency ledger.
--
-- The webhook handler claims each Stripe event by inserting its id here before
-- processing. The primary key turns a replay (same event id) into a unique
-- violation — including across replicas — letting the handler detect and skip
-- duplicates so non-idempotent side effects (e.g. meter `recharge` POSTs) never
-- fire twice. Also serves as a lightweight audit trail of processed events.

create table if not exists public.stripe_billing_events (
  event_id     text primary key,
  type         text,
  payload      jsonb,
  processed_at timestamptz not null default now()
);

-- Service role writes via the admin client; no public/anon access.
alter table public.stripe_billing_events enable row level security;
