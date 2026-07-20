CREATE TABLE IF NOT EXISTS public.identity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_subject),
  UNIQUE(provider, user_id)
);

CREATE INDEX IF NOT EXISTS identity_links_user_idx ON public.identity_links(user_id);

ALTER TABLE public.identity_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_links FROM anon, authenticated;

ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS experience_grants text[] NOT NULL DEFAULT ARRAY['aros']::text[];

ALTER TABLE public.oidc_rp_sessions
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.workspace_experience_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  workspace_kind text NOT NULL DEFAULT 'operator'
    CHECK (workspace_kind IN ('operator','developer','reseller','internal')),
  default_experience text NOT NULL DEFAULT 'aros'
    CHECK (default_experience IN ('aros','mib')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_experience_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_experience_settings FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.user_experience_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  preferred_experience text NOT NULL CHECK (preferred_experience IN ('aros','mib')),
  last_selected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, tenant_id)
);

ALTER TABLE public.user_experience_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_experience_preferences FROM anon, authenticated;

INSERT INTO public.workspace_experience_settings (tenant_id, workspace_kind, default_experience)
SELECT id, 'operator', 'aros'
FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;
