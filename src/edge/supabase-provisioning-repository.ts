import type { SupabaseClient } from '@supabase/supabase-js';
import type { EdgeDeviceView, EdgeProvisioningRepository } from './provisioning.js';

export class SupabaseEdgeProvisioningRepository implements EdgeProvisioningRepository {
  constructor(private readonly db: SupabaseClient) {}

  async storeExists(tenantId: string, storeId: string) {
    const { data, error } = await this.db.from('stores').select('id').eq('tenant_id', tenantId).eq('id', storeId).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }
  async connectorExists(tenantId: string, storeId: string, connectorId: string) {
    const { data, error } = await this.db.from('pos_connections').select('id').eq('tenant_id', tenantId).eq('store_id', storeId).eq('id', connectorId).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }
  async createActivation(input: { tenantId:string; storeId:string; connectorId?:string; codeHash:string; expiresAt:string }) {
    const { data, error } = await this.db.from('edge_activation_tokens').insert({
      tenant_id: input.tenantId, store_id: input.storeId, connector_id: input.connectorId ?? null,
      provider: 'verifone', code_hash: input.codeHash, expires_at: input.expiresAt,
    }).select('id').single();
    if (error) throw error;
    return data.id as string;
  }
  async listDevices(tenantId: string, storeId?: string): Promise<EdgeDeviceView[]> {
    let query = this.db.from('edge_devices').select('id,store_id,connector_id,provider,machine_id,device_name,operating_system,architecture,service_version,connector_version,status,last_heartbeat_at,created_at,revoked_at,edge_device_heartbeats(payload,received_at)').eq('tenant_id', tenantId);
    if (storeId) query = query.eq('store_id', storeId);
    const { data, error } = await query.order('created_at', { ascending: false }).order('received_at', { referencedTable: 'edge_device_heartbeats', ascending: false }).limit(1, { referencedTable: 'edge_device_heartbeats' });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id, storeId: row.store_id, connectorId: row.connector_id, provider: row.provider,
      machineId: row.machine_id, deviceName: row.device_name || row.machine_id,
      operatingSystem: row.operating_system, architecture: row.architecture,
      serviceVersion: row.service_version, connectorVersion: row.connector_version,
      status: row.status, lastHeartbeatAt: row.last_heartbeat_at,
      createdAt: row.created_at, revokedAt: row.revoked_at,
      latestHeartbeat: row.edge_device_heartbeats?.[0]?.payload ?? null,
    }));
  }
  async hasUsableActivation(tenantId: string, storeId: string) {
    const { data, error } = await this.db.from('edge_activation_tokens').select('id').eq('tenant_id', tenantId).eq('store_id', storeId)
      .is('consumed_at', null).gt('expires_at', new Date().toISOString()).limit(1);
    if (error) throw error;
    return Boolean(data?.length);
  }
}
