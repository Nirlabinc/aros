-- Terms-acceptance + AI-disclosure consent evidence (flag-gated feature:
-- TERMS_GATE_ENABLED, default off). terms_acceptances is APPEND-ONLY legal
-- evidence — clickwrap assent is only enforceable when it is affirmative,
-- conspicuous, and logged. Rows are retained for the life of the account plus
-- the statute of limitations, so there are intentionally NO foreign keys and
-- NO cascade deletes: the evidence must survive tenant/user removal.

CREATE TABLE IF NOT EXISTS public.terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid,
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS terms_acceptances_user_version
  ON public.terms_acceptances(user_id, terms_version);
CREATE INDEX IF NOT EXISTS terms_acceptances_tenant
  ON public.terms_acceptances(tenant_id);

-- Append-only enforcement: block UPDATE and DELETE at the database level,
-- even for the service role. Corrections are expressed as new rows.
CREATE OR REPLACE FUNCTION public.terms_acceptances_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'terms_acceptances is append-only; % is not allowed', TG_OP;
END; $$;

DROP TRIGGER IF EXISTS terms_acceptances_append_only ON public.terms_acceptances;
CREATE TRIGGER terms_acceptances_append_only
  BEFORE UPDATE OR DELETE ON public.terms_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.terms_acceptances_block_mutation();

-- Per-feature disclosure acknowledgements (e.g. the first-chat AI popup).
-- One row per user per disclosure key per version; re-shown on version bump.
CREATE TABLE IF NOT EXISTS public.user_disclosures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid,
  disclosure_key text NOT NULL,
  version text NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, disclosure_key, version)
);

CREATE INDEX IF NOT EXISTS user_disclosures_user
  ON public.user_disclosures(user_id);

-- Service-role only, same posture as oidc_rp_* — browser clients go through
-- the platform API, which stamps ip / user_agent / timestamps server-side.
ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_disclosures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.terms_acceptances, public.user_disclosures FROM anon, authenticated;
