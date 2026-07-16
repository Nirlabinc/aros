import { describe, expect, it } from 'vitest';
import { EdgeProvisioningService, type EdgeDeviceView, type EdgeProvisioningRepository } from '../provisioning.js';

class Repository implements EdgeProvisioningRepository {
  stores = new Set(['tenant-a:store-a', 'tenant-b:store-b']);
  connectors = new Set(['tenant-a:store-a:connector-a']);
  activations: Array<{tenantId:string;storeId:string;connectorId?:string;codeHash:string;expiresAt:string}> = [];
  devices: Array<EdgeDeviceView & {tenantId:string}> = [];
  async storeExists(tenantId:string, storeId:string) { return this.stores.has(`${tenantId}:${storeId}`); }
  async connectorExists(tenantId:string, storeId:string, connectorId:string) { return this.connectors.has(`${tenantId}:${storeId}:${connectorId}`); }
  async createActivation(input:any) { this.activations.push(input); return 'activation-id'; }
  async listDevices(tenantId:string, storeId?:string) { return this.devices.filter(d => d.tenantId===tenantId && (!storeId || d.storeId===storeId)); }
  async hasUsableActivation(tenantId:string, storeId:string) { return this.activations.some(a => a.tenantId===tenantId && a.storeId===storeId); }
}
const owner = { tenantId:'tenant-a', userId:'user', role:'owner' };

describe('EdgeProvisioningService', () => {
  it('creates a short-lived code and stores only its hash', async () => {
    const repo=new Repository(); const service=new EdgeProvisioningService(repo);
    const result=await service.createActivationCode(owner,{storeId:'store-a',connectorId:'connector-a'});
    expect(result.activationCode).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){2}$/);
    expect(repo.activations[0].codeHash).not.toContain(result.activationCode);
    expect(repo.activations[0].tenantId).toBe('tenant-a');
  });
  it('denies members and cross-tenant store or connector provisioning', async () => {
    const service=new EdgeProvisioningService(new Repository());
    await expect(service.createActivationCode({...owner,role:'member'},{storeId:'store-a'})).rejects.toThrow('EDGE_FORBIDDEN');
    await expect(service.createActivationCode(owner,{storeId:'store-b'})).rejects.toThrow('EDGE_STORE_NOT_FOUND');
    await expect(service.createActivationCode(owner,{storeId:'store-a',connectorId:'other'})).rejects.toThrow('EDGE_CONNECTOR_NOT_FOUND');
  });
  it('lists and summarizes devices only inside the authenticated tenant', async () => {
    const repo=new Repository();
    repo.devices.push(
      {tenantId:'tenant-a',id:'a',storeId:'store-a',connectorId:null,provider:'verifone',machineId:'mac',deviceName:'Store Mac',operatingSystem:'macOS',architecture:'arm64',serviceVersion:'1',connectorVersion:'1',status:'online',lastHeartbeatAt:'now',createdAt:'now',revokedAt:null,latestHeartbeat:{commanderReachable:true,lastCloudUpload:'now'}},
      {tenantId:'tenant-b',id:'b',storeId:'store-b',connectorId:null,provider:'verifone',machineId:'other',deviceName:'Other',operatingSystem:'Windows',architecture:'x64',serviceVersion:'1',connectorVersion:'1',status:'online',lastHeartbeatAt:'now',createdAt:'now',revokedAt:null},
    );
    const service=new EdgeProvisioningService(repo);
    expect((await service.listDevices(owner)).map(d=>d.id)).toEqual(['a']);
    const status=await service.onboardingStatus(owner,'store-a');
    expect(status.state).toBe('connected');
    expect(status.steps.initialSyncComplete).toBe(true);
  });
});
