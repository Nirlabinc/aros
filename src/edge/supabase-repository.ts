import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActivationRequest, EventBatchRequest, HeartbeatRequest } from './contracts.js';
import type { DeviceConfiguration, DeviceIdentity, EdgeRepository, Enrollment } from './service.js';

export class SupabaseEdgeRepository implements EdgeRepository {
  constructor(private readonly db: SupabaseClient) {}

  async consumeActivation(codeHash: string, input: ActivationRequest, deviceId: string, tokenHash: string): Promise<Enrollment | null> {
    const { data, error } = await this.db.rpc('consume_edge_activation', {
      p_code_hash: codeHash, p_machine_id: input.machineId, p_device_id: deviceId, p_token_hash: tokenHash,
      p_device_name: input.machineId, p_operating_system: input.operatingSystem,
      p_architecture: input.architecture, p_service_version: input.serviceVersion,
      p_connector_version: input.connectorVersion,
    });
    if (error) throw error;
    const row = data?.[0];
    return row ? { deviceId: row.device_id, tenantId: row.tenant_id, storeId: row.store_id, provider: row.provider, tokenId: row.token_id } : null;
  }

  async findDeviceByToken(compound: string): Promise<DeviceIdentity | null> {
    const [tokenId, tokenHash] = compound.split(':');
    const { data, error } = await this.db.from('edge_device_tokens').select('edge_devices!inner(id,tenant_id,store_id,provider)')
      .eq('id', tokenId).eq('token_hash', tokenHash).is('revoked_at', null).maybeSingle();
    if (error) throw error;
    const device = (data as any)?.edge_devices;
    return device ? { deviceId: device.id, tenantId: device.tenant_id, storeId: device.store_id, provider: device.provider } : null;
  }

  async recordHeartbeat(device: DeviceIdentity, heartbeat: HeartbeatRequest): Promise<void> {
    const { error } = await this.db.from('edge_device_heartbeats').insert({
      device_id: device.deviceId, tenant_id: device.tenantId, store_id: device.storeId, payload: heartbeat,
    });
    if (error) throw error;
    await this.db.from('edge_devices').update({
      last_heartbeat_at: new Date().toISOString(), status: heartbeat.commanderReachable ? 'online' : 'degraded',
      service_version: heartbeat.serviceVersion, connector_version: heartbeat.connectorVersion,
    }).eq('id', device.deviceId);
  }

  async persistBatch(device: DeviceIdentity, batch: EventBatchRequest) {
    const { data, error } = await this.db.rpc('ingest_edge_event_batch', {
      p_device_id: device.deviceId, p_tenant_id: device.tenantId, p_store_id: device.storeId,
      p_batch_id: batch.batchId, p_sequence: batch.sequence, p_captured_at: batch.capturedAt, p_events: batch.events,
    });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({ eventId: row.event_id, status: row.status as 'accepted' | 'duplicate' }));
  }

  async getConfiguration(device: DeviceIdentity): Promise<DeviceConfiguration | null> {
    const { data, error } = await this.db.from('edge_devices')
      .select('sync_interval_seconds,enabled_read_capabilities,config_version')
      .eq('id', device.deviceId).eq('tenant_id', device.tenantId).eq('store_id', device.storeId)
      .eq('provider', device.provider).is('revoked_at', null).maybeSingle();
    if (error) throw error;
    return data ? {
      mode: 'read_only',
      syncIntervalSeconds: data.sync_interval_seconds,
      enabledReadCapabilities: data.enabled_read_capabilities ?? [],
      configVersion: data.config_version,
    } : null;
  }
}
