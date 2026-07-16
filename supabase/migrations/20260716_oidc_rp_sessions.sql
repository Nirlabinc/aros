-- Durable, horizontally-safe OIDC relying-party state. Only lookup hashes and
-- encrypted envelopes are stored; raw state, cookies, verifiers, and tokens
-- never enter Postgres.
CREATE TABLE IF NOT EXISTS public.oidc_rp_transactions (
  state_hash text PRIMARY KEY, browser_hash text NOT NULL, sealed_payload text NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.oidc_rp_sessions (
  session_hash text PRIMARY KEY, subject text NOT NULL, workspace_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','member','viewer')), sealed_payload text NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oidc_rp_transactions_expiry ON public.oidc_rp_transactions(expires_at);
CREATE INDEX IF NOT EXISTS oidc_rp_sessions_expiry ON public.oidc_rp_sessions(expires_at);
ALTER TABLE public.oidc_rp_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oidc_rp_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oidc_rp_transactions, public.oidc_rp_sessions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_oidc_rp_transaction(p_state_hash text, p_browser_hash text)
RETURNS TABLE(sealed_payload text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RETURN QUERY UPDATE public.oidc_rp_transactions SET consumed_at=now()
    WHERE state_hash=p_state_hash AND browser_hash=p_browser_hash AND consumed_at IS NULL AND expires_at>now()
    RETURNING oidc_rp_transactions.sealed_payload;
END; $$;
REVOKE ALL ON FUNCTION public.consume_oidc_rp_transaction(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_oidc_rp_transaction(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_oidc_rp_state() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  DELETE FROM public.oidc_rp_transactions WHERE expires_at<=now() OR consumed_at<now()-interval '1 hour';
  DELETE FROM public.oidc_rp_sessions WHERE expires_at<=now() OR revoked_at<now()-interval '24 hours';
$$;
REVOKE ALL ON FUNCTION public.cleanup_oidc_rp_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_oidc_rp_state() TO service_role;
