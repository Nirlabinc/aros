-- Make activation crash-safe: if the first successful HTTP response is lost,
-- the same machine may retry the still-valid code and receive a fresh token.
-- A consumed code remains unusable by every other machine.
CREATE OR REPLACE FUNCTION consume_edge_activation(p_code_hash TEXT, p_machine_id TEXT, p_device_id UUID, p_token_hash TEXT)
RETURNS TABLE(device_id UUID, tenant_id UUID, store_id UUID, provider TEXT, token_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  activation edge_activation_tokens%ROWTYPE;
  enrolled_device edge_devices%ROWTYPE;
  new_token UUID := gen_random_uuid();
BEGIN
  SELECT * INTO activation
    FROM edge_activation_tokens
    WHERE code_hash = p_code_hash
    FOR UPDATE;

  IF NOT FOUND OR activation.expires_at <= now() THEN RETURN; END IF;

  IF activation.consumed_at IS NOT NULL THEN
    SELECT * INTO enrolled_device
      FROM edge_devices
      WHERE tenant_id = activation.tenant_id
        AND store_id = activation.store_id
        AND machine_id = p_machine_id
        AND revoked_at IS NULL;

    IF NOT FOUND THEN RETURN; END IF;

    -- Only the newest retry credential remains valid. This bounds credentials
    -- even when multiple responses are lost or arrive out of order.
    UPDATE edge_device_tokens AS credentials
      SET revoked_at = now()
      WHERE credentials.device_id = enrolled_device.id AND credentials.revoked_at IS NULL;
    INSERT INTO edge_device_tokens(id, device_id, token_hash)
      VALUES(new_token, enrolled_device.id, p_token_hash);
    INSERT INTO audit_log(tenant_id, action, resource, detail)
      VALUES(activation.tenant_id, 'edge.device.activation_retried', 'edge_device',
        jsonb_build_object('device_id', enrolled_device.id, 'store_id', activation.store_id));

    RETURN QUERY SELECT enrolled_device.id, activation.tenant_id, activation.store_id,
      activation.provider, new_token;
    RETURN;
  END IF;

  UPDATE edge_activation_tokens
    SET attempts = attempts + 1
    WHERE id = activation.id;
  IF activation.attempts >= activation.max_attempts THEN RETURN; END IF;

  INSERT INTO edge_devices(id, tenant_id, store_id, connector_id, provider, machine_id)
    VALUES(p_device_id, activation.tenant_id, activation.store_id, activation.connector_id,
      activation.provider, p_machine_id);
  INSERT INTO edge_device_tokens(id, device_id, token_hash)
    VALUES(new_token, p_device_id, p_token_hash);
  UPDATE edge_activation_tokens SET consumed_at = now() WHERE id = activation.id;
  INSERT INTO audit_log(tenant_id, action, resource, detail)
    VALUES(activation.tenant_id, 'edge.device.enrolled', 'edge_device',
      jsonb_build_object('device_id', p_device_id, 'store_id', activation.store_id));

  RETURN QUERY SELECT p_device_id, activation.tenant_id, activation.store_id,
    activation.provider, new_token;
END $$;
