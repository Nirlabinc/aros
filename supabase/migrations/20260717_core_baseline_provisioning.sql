-- Core baseline provisioning: every tenant gets a default concierge agent and
-- a connector-independent skill from day one, via the manifest system added in
-- 20260716_manifest_provisioning.sql. New signups apply this manifest from the
-- server; this migration seeds the manifest and backfills existing tenants.
-- (Dated 20260717 so it sorts after 20260716_manifest_provisioning.sql, which
-- defines apply_provisioning_manifest.)

INSERT INTO public.provisioning_manifests(key,source_kind,source_key,version,resources) VALUES
('app.core.v1','app','core','1.0.0','[
 {"kind":"agent","provider":"shreai","name":"AROS Concierge","capabilities":["chat.general","delegation"],
  "config":{"agentId":"aros-agent","systemManaged":true,"description":"Default workspace agent. Answers questions, routes work to specialist agents, and uses whichever tools your connected apps and stores unlock."}},
 {"kind":"skill","provider":"aros","name":"Workspace Q&A","capabilities":["chat.general"],
  "config":{"systemManaged":true,"description":"Ask about your workspace, setup, and connected capabilities. Available before any store or app is connected."}}
]'::jsonb)
ON CONFLICT (key) DO UPDATE SET version=EXCLUDED.version,resources=EXCLUDED.resources,active=true,updated_at=now();

-- Backfill: attach the core baseline to every existing tenant. Idempotent —
-- apply_provisioning_manifest re-binds and reactivates on conflict.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id, owner_id FROM public.tenants
  LOOP
    PERFORM public.apply_provisioning_manifest(t.id,'app','core','app.core.v1',true,t.owner_id);
  END LOOP;
END $$;
