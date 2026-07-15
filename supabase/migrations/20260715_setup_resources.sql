-- Tenant-scoped registry for channels, connections, agents, and skills.
CREATE TABLE IF NOT EXISTS public.tenant_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('channel','pos','app','agent','skill','model')),
  provider text,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive','configuring','active','degraded','failed')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  store_ids uuid[] NOT NULL DEFAULT '{}',
  capabilities text[] NOT NULL DEFAULT '{}',
  health jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_resources_tenant_kind ON public.tenant_resources(tenant_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_resources_tenant_name ON public.tenant_resources(tenant_id, kind, name);

DROP TRIGGER IF EXISTS touch_tenant_resources ON public.tenant_resources;
CREATE TRIGGER touch_tenant_resources BEFORE UPDATE ON public.tenant_resources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.tenant_resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_resources_select_member ON public.tenant_resources;
CREATE POLICY tenant_resources_select_member ON public.tenant_resources FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active')
);
DROP POLICY IF EXISTS tenant_resources_write_admin ON public.tenant_resources;
CREATE POLICY tenant_resources_write_admin ON public.tenant_resources FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND role IN ('owner','admin') AND status = 'active')
) WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND role IN ('owner','admin') AND status = 'active')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_resources TO authenticated;

CREATE TABLE IF NOT EXISTS public.model_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  model_id text NOT NULL, token_hash text NOT NULL UNIQUE, created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.model_enrollments ENABLE ROW LEVEL SECURITY;
-- Enrollment tokens are exchanged server-to-server; no browser table access is granted.

CREATE TABLE IF NOT EXISTS public.model_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  model_id text NOT NULL, key_alias text NOT NULL, key_fingerprint text NOT NULL UNIQUE, device_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz, UNIQUE (tenant_id, key_alias)
);
ALTER TABLE public.model_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_credentials_select_member ON public.model_credentials FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active')
);
GRANT SELECT ON public.model_credentials TO authenticated;

CREATE TABLE IF NOT EXISTS public.platform_apps (
  id text PRIMARY KEY, name text NOT NULL, launch_url text NOT NULL, repo text NOT NULL,
  auth_provider text NOT NULL DEFAULT 'shre-auth', vault_namespace text NOT NULL,
  required_scopes text[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'migration-needed', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_apps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_apps_read ON public.platform_apps;
CREATE POLICY platform_apps_read ON public.platform_apps FOR SELECT USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.platform_apps TO authenticated;

INSERT INTO public.platform_apps(id,name,launch_url,repo,vault_namespace,required_scopes,status) VALUES
('storepulse','StorePulse','https://storepulse.aros.live','Shreai/shreai/apps/storepulse-ui','shre/aros/storepulse-ui',ARRAY['stores:read','pos:read'],'migration-needed'),
('storepulse-hq','StorePulse HQ','https://storepulse-hq.aros.live','canonical repo pending','shre/aros/storepulse-hq',ARRAY['stores:read','fleet:read'],'planned'),
('cpg','CPG Intelligence','https://cpg.aros.live','Nirpat3/cpg-intelligence','nirlab/cpg-intelligence',ARRAY['cpg:read','stores:read'],'migration-needed'),
('mib','MIB','https://mib.aros.live','Shreai/shre-command-center','shre/mib',ARRAY['workspace:admin'],'active'),
('centrix','Centrix','https://centrix.aros.live','Nirpat3/centrix','nirlab/centrix',ARRAY['crm:read','tickets:write'],'migration-needed'),
('rapidsupport','RapidSupport','https://rapidsupport.aros.live','Nirlabinc/RapidSupport','nirlab/rapidsupport',ARRAY['support:read','support:write'],'partial'),
('aichatbot','AI Call Bot','https://aichatbot.aros.live','Nirpat3/ai-call-assistant','nirlab/ai-call-assistant',ARRAY['calls:read','calls:write'],'planned')
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,launch_url=EXCLUDED.launch_url,repo=EXCLUDED.repo,vault_namespace=EXCLUDED.vault_namespace,required_scopes=EXCLUDED.required_scopes,status=EXCLUDED.status;

-- Safe defaults. Provider credentials are intentionally absent: only vault references belong in config.
INSERT INTO public.tenant_resources (tenant_id, kind, provider, name, status, capabilities, config)
SELECT id, 'channel', 'aros', 'AROS Chat', 'active', ARRAY['message.receive','message.send'], '{"native":true}'::jsonb FROM public.tenants
ON CONFLICT (tenant_id, kind, name) DO NOTHING;
INSERT INTO public.tenant_resources (tenant_id, kind, provider, name, status, capabilities, config)
SELECT id, 'agent', 'shreai', 'Store Operations Agent', 'active', ARRAY['operations.read','health.read'], '{}'::jsonb FROM public.tenants
ON CONFLICT (tenant_id, kind, name) DO NOTHING;
INSERT INTO public.tenant_resources (tenant_id, kind, provider, name, status, capabilities, config)
SELECT id, 'skill', 'aros', 'Daily Sales Summary', 'active', ARRAY['pos.sales.read'], '{"version":"1.0.0"}'::jsonb FROM public.tenants
ON CONFLICT (tenant_id, kind, name) DO NOTHING;
INSERT INTO public.tenant_resources (tenant_id, kind, provider, name, status, capabilities, config)
SELECT id, 'model', 'aum', 'AUM (Local)', 'configuring', ARRAY['chat.completions'], '{"modelId":"shre-70b","endpoint":"http://127.0.0.1:5480/v1","local":true}'::jsonb FROM public.tenants
ON CONFLICT (tenant_id, kind, name) DO NOTHING;
