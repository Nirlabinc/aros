-- Prepaid token wallet (founder model 2026-07-23): $50 free credit, usage
-- draws it down, add balance to continue, optional auto-recharge.
--
-- Keyed by WORKSPACE (the customer). Balance is COMPUTED, never stored:
--   balance = SUM(wallet_ledger.amount_usd)  -  metered usage (shre-meter)
-- so it can never drift from the meter (the usage source of truth).

CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  amount_usd numeric(12,4) NOT NULL,          -- positive = credit added
  kind text NOT NULL CHECK (kind IN ('onboarding_grant','topup','auto_recharge','adjustment')),
  stripe_ref text,                            -- payment_intent / checkout id
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_ledger_tenant ON public.wallet_ledger(tenant_id);
-- One credit per Stripe payment (idempotent webhook / retry safe).
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_stripe_ref
  ON public.wallet_ledger(stripe_ref) WHERE stripe_ref IS NOT NULL;
-- One onboarding grant per workspace, ever.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_one_grant
  ON public.wallet_ledger(tenant_id) WHERE kind = 'onboarding_grant';

CREATE TABLE IF NOT EXISTS public.wallet_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  auto_recharge_enabled boolean NOT NULL DEFAULT false,
  auto_recharge_threshold_usd numeric(12,2) NOT NULL DEFAULT 10,
  auto_recharge_amount_usd numeric(12,2) NOT NULL DEFAULT 25,
  stripe_payment_method_id text,
  low_balance_notified_at timestamptz,
  auto_recharge_failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Members may READ their workspace wallet; all writes are server-side
-- (service role) after membership validation — no authenticated write path.
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_ledger_member_read ON public.wallet_ledger;
CREATE POLICY wallet_ledger_member_read ON public.wallet_ledger FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active')
);
DROP POLICY IF EXISTS wallet_settings_member_read ON public.wallet_settings;
CREATE POLICY wallet_settings_member_read ON public.wallet_settings FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active')
);

GRANT SELECT ON public.wallet_ledger TO authenticated;
GRANT SELECT ON public.wallet_settings TO authenticated;
