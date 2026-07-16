-- Persist the human-readable inventory shown in Workspace > Computers.
ALTER TABLE public.edge_devices
  ADD COLUMN IF NOT EXISTS device_name text,
  ADD COLUMN IF NOT EXISTS operating_system text,
  ADD COLUMN IF NOT EXISTS architecture text,
  ADD COLUMN IF NOT EXISTS service_version text,
  ADD COLUMN IF NOT EXISTS connector_version text;

UPDATE public.edge_devices SET device_name = machine_id WHERE device_name IS NULL;

DROP FUNCTION IF EXISTS public.consume_edge_activation(text, text, uuid, text);
CREATE OR REPLACE FUNCTION public.consume_edge_activation(
  p_code_hash text, p_machine_id text, p_device_id uuid, p_token_hash text,
  p_device_name text, p_operating_system text, p_architecture text,
  p_service_version text, p_connector_version text
)
RETURNS TABLE(device_id uuid, tenant_id uuid, store_id uuid, provider text, token_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE activation edge_activation_tokens%ROWTYPE; new_token uuid := gen_random_uuid();
BEGIN
  SELECT * INTO activation FROM edge_activation_tokens WHERE code_hash=p_code_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE edge_activation_tokens SET attempts=attempts+1 WHERE id=activation.id;
  IF activation.consumed_at IS NOT NULL OR activation.expires_at <= now() OR activation.attempts >= activation.max_attempts THEN RETURN; END IF;
  INSERT INTO edge_devices(id,tenant_id,store_id,connector_id,provider,machine_id,device_name,operating_system,architecture,service_version,connector_version)
    VALUES(p_device_id,activation.tenant_id,activation.store_id,activation.connector_id,activation.provider,p_machine_id,
      COALESCE(NULLIF(p_device_name,''),p_machine_id),p_operating_system,p_architecture,p_service_version,p_connector_version);
  INSERT INTO edge_device_tokens(id,device_id,token_hash) VALUES(new_token,p_device_id,p_token_hash);
  UPDATE edge_activation_tokens SET consumed_at=now() WHERE id=activation.id;
  INSERT INTO audit_log(tenant_id,action,resource,detail)
    VALUES(activation.tenant_id,'edge.device.enrolled','edge_device',jsonb_build_object('device_id',p_device_id,'store_id',activation.store_id));
  RETURN QUERY SELECT p_device_id,activation.tenant_id,activation.store_id,activation.provider,new_token;
END $$;
