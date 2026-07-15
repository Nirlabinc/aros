-- AROS edge control plane v1. Tokens are stored only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS edge_activation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES pos_connections(id) ON DELETE SET NULL, provider TEXT NOT NULL DEFAULT 'verifone', code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  setup JSONB NOT NULL DEFAULT '{"products":["aros"],"deploymentMode":"existing-computer","remoteCommanderAccess":false}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE edge_activation_tokens ADD COLUMN IF NOT EXISTS setup JSONB NOT NULL DEFAULT '{"products":["aros"],"deploymentMode":"existing-computer","remoteCommanderAccess":false}'::jsonb;
CREATE TABLE IF NOT EXISTS edge_devices (
  id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES pos_connections(id) ON DELETE SET NULL,
  provider TEXT NOT NULL, machine_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'enrolled',
  sync_interval_seconds INTEGER NOT NULL DEFAULT 300,
  enabled_read_capabilities TEXT[] NOT NULL DEFAULT ARRAY['catalog.read','transactions.read']::TEXT[],
  config_version BIGINT NOT NULL DEFAULT 1,
  last_heartbeat_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ,
  UNIQUE (tenant_id, store_id, machine_id)
);
CREATE TABLE IF NOT EXISTS edge_device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), device_id UUID NOT NULL REFERENCES edge_devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS edge_device_heartbeats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, device_id UUID NOT NULL REFERENCES edge_devices(id),
  tenant_id UUID NOT NULL, store_id UUID NOT NULL, payload JSONB NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS edge_event_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), device_id UUID NOT NULL REFERENCES edge_devices(id), tenant_id UUID NOT NULL,
  store_id UUID NOT NULL, source_batch_id TEXT NOT NULL, sequence BIGINT NOT NULL, captured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (device_id, source_batch_id)
);
CREATE TABLE IF NOT EXISTS edge_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), batch_id UUID NOT NULL REFERENCES edge_event_batches(id), device_id UUID NOT NULL,
  tenant_id UUID NOT NULL, store_id UUID NOT NULL, event_id TEXT NOT NULL, event_type TEXT NOT NULL,
  source_id TEXT NOT NULL, source_timestamp TIMESTAMPTZ NOT NULL, idempotency_key TEXT NOT NULL, payload JSONB NOT NULL,
  raw_payload_ref TEXT, received_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (device_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS edge_events_store_time_idx ON edge_events (tenant_id, store_id, source_timestamp DESC);

-- These tables are accessed through tenant-authenticated server APIs or scoped
-- SECURITY DEFINER functions. Never expose service-role data through PostgREST.
ALTER TABLE edge_activation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_device_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_event_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION consume_edge_activation(p_code_hash TEXT, p_machine_id TEXT, p_device_id UUID, p_token_hash TEXT)
RETURNS TABLE(device_id UUID, tenant_id UUID, store_id UUID, provider TEXT, token_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE token edge_activation_tokens%ROWTYPE; new_token UUID := gen_random_uuid();
BEGIN
  SELECT * INTO token FROM edge_activation_tokens WHERE code_hash=p_code_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE edge_activation_tokens SET attempts=attempts+1 WHERE id=token.id;
  IF token.consumed_at IS NOT NULL OR token.expires_at <= now() OR token.attempts >= token.max_attempts THEN RETURN; END IF;
  INSERT INTO edge_devices(id,tenant_id,store_id,connector_id,provider,machine_id)
    VALUES(p_device_id,token.tenant_id,token.store_id,token.connector_id,token.provider,p_machine_id);
  INSERT INTO edge_device_tokens(id,device_id,token_hash) VALUES(new_token,p_device_id,p_token_hash);
  UPDATE edge_activation_tokens SET consumed_at=now() WHERE id=token.id;
  INSERT INTO audit_log(tenant_id,action,resource,detail)
    VALUES(token.tenant_id,'edge.device.enrolled','edge_device',jsonb_build_object('device_id',p_device_id,'store_id',token.store_id));
  RETURN QUERY SELECT p_device_id,token.tenant_id,token.store_id,token.provider,new_token;
END $$;

CREATE OR REPLACE FUNCTION ingest_edge_event_batch(p_device_id UUID,p_tenant_id UUID,p_store_id UUID,p_batch_id TEXT,p_sequence BIGINT,p_captured_at TIMESTAMPTZ,p_events JSONB)
RETURNS TABLE(event_id TEXT,status TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE batch_uuid UUID; event JSONB; inserted_id UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM edge_devices d WHERE d.id=p_device_id AND d.tenant_id=p_tenant_id AND d.store_id=p_store_id AND d.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'device ownership mismatch';
  END IF;
  INSERT INTO edge_event_batches(device_id,tenant_id,store_id,source_batch_id,sequence,captured_at)
    VALUES(p_device_id,p_tenant_id,p_store_id,p_batch_id,p_sequence,p_captured_at)
    ON CONFLICT(device_id,source_batch_id) DO UPDATE SET source_batch_id=EXCLUDED.source_batch_id RETURNING id INTO batch_uuid;
  FOR event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    inserted_id := NULL;
    INSERT INTO edge_events(batch_id,device_id,tenant_id,store_id,event_id,event_type,source_id,source_timestamp,idempotency_key,payload,raw_payload_ref)
      VALUES(batch_uuid,p_device_id,p_tenant_id,p_store_id,event->>'eventId',event->>'eventType',event->>'sourceId',(event->>'sourceTimestamp')::timestamptz,event->>'idempotencyKey',event->'payload',event->>'rawPayloadRef')
      ON CONFLICT(device_id,idempotency_key) DO NOTHING RETURNING id INTO inserted_id;
    event_id := event->>'eventId'; status := CASE WHEN inserted_id IS NULL THEN 'duplicate' ELSE 'accepted' END; RETURN NEXT;
  END LOOP;
END $$;
