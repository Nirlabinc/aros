-- ── Regulars Phase 1 follow-up (task #18): least-privilege role for the ──────
-- public unauthenticated commerce surface.
--
-- WHY: the public /api/public/businesses/* handler currently runs on the
-- service-role client (RLS-bypassing, whole-DB reach). A single future query
-- bug on that stranger-facing path could read or mutate arbitrary tenant data.
-- Workspace permissions rule: "if an agent can't reach a room, it can't break
-- things in that room." This role can reach ONLY the three public objects.
--
-- WIRING (operator, after apply): the API opens a dedicated pg pool as this
-- role for the public path (see src/public/db.ts scaffold + docs). The role's
-- password is provisioned in vault (vault.aros.live: regulars/public-db-role)
-- and injected as PUBLIC_API_DB_URL — never in .env, never the service key.
-- Until wired, the handler keeps using the service role behind the REVOKE +
-- security_invoker protections already shipped; this migration is inert to the
-- running code (no behavior change on apply).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'regulars_public') THEN
    -- NOLOGIN placeholder: operator sets a password out-of-band (ALTER ROLE
    -- regulars_public LOGIN PASSWORD '<from vault>') so no secret lives in git.
    CREATE ROLE regulars_public NOLOGIN;
  END IF;
END $$;

-- Reach: the public schema, and ONLY the three customer-safe objects.
GRANT USAGE ON SCHEMA public TO regulars_public;
GRANT SELECT ON public.public_products_v TO regulars_public;
GRANT SELECT ON public.public_promotions TO regulars_public;
GRANT SELECT, INSERT, UPDATE ON public.public_cart_drafts TO regulars_public;
GRANT EXECUTE ON FUNCTION public.purge_expired_cart_drafts() TO regulars_public;

-- Also needs to resolve businesses. Public reads of tenant/store identity are
-- limited to the columns the customer surface already exposes; grant SELECT on
-- the two identity tables (the handler selects only slug/name/status/timezone/
-- metadata — no billing, members, or connector secrets live there).
GRANT SELECT ON public.tenants TO regulars_public;
GRANT SELECT ON public.stores TO regulars_public;

-- Explicitly deny everything else this role might otherwise inherit by default.
-- (Belt-and-suspenders: default privileges are not granted to a fresh role,
-- but make the intent auditable.)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM regulars_public;
GRANT SELECT ON public.public_products_v, public.public_promotions,
                public.tenants, public.stores TO regulars_public;
GRANT SELECT, INSERT, UPDATE ON public.public_cart_drafts TO regulars_public;

COMMENT ON ROLE regulars_public IS
  'Least-privilege role for the public customer commerce API. Reaches only public_products_v, public_promotions, public_cart_drafts, tenants(read), stores(read). Never the service role. Task #18.';
