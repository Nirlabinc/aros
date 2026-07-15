import { randomBytes } from 'node:crypto';
import { hashSecret } from './service.js';

export interface ProvisioningAuth { tenantId: string; userId: string; role: string }
export interface EdgeSetupPreferences { products: Array<'aros' | 'cstoresku'>; deploymentMode: 'existing-computer' | 'managed-edge'; remoteCommanderAccess: boolean }
export interface ActivationCodeInput { storeId: string; connectorId?: string; expiresInMinutes?: number; setup?: EdgeSetupPreferences }
export interface EdgeDeviceView {
  id: string; storeId: string; connectorId: string | null; provider: string; machineId: string;
  status: string; lastHeartbeatAt: string | null; createdAt: string; revokedAt: string | null;
  latestHeartbeat?: Record<string, unknown> | null;
}
export interface EdgeProvisioningRepository {
  storeExists(tenantId: string, storeId: string): Promise<boolean>;
  connectorExists(tenantId: string, storeId: string, connectorId: string): Promise<boolean>;
  createActivation(input: { tenantId: string; storeId: string; connectorId?: string; codeHash: string; expiresAt: string; setup: EdgeSetupPreferences }): Promise<string>;
  listDevices(tenantId: string, storeId?: string): Promise<EdgeDeviceView[]>;
  hasUsableActivation(tenantId: string, storeId: string): Promise<boolean>;
}

const MANAGER_ROLES = new Set(['owner', 'admin']);
const code = () => randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-');

export class EdgeProvisioningService {
  constructor(private readonly repository: EdgeProvisioningRepository) {}

  async createActivationCode(auth: ProvisioningAuth, input: ActivationCodeInput) {
    if (!MANAGER_ROLES.has(auth.role)) throw new Error('EDGE_FORBIDDEN');
    if (!await this.repository.storeExists(auth.tenantId, input.storeId)) throw new Error('EDGE_STORE_NOT_FOUND');
    if (input.connectorId && !await this.repository.connectorExists(auth.tenantId, input.storeId, input.connectorId)) {
      throw new Error('EDGE_CONNECTOR_NOT_FOUND');
    }
    const expiresInMinutes = input.expiresInMinutes ?? 15;
    if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 5 || expiresInMinutes > 60) throw new Error('EDGE_INVALID_EXPIRY');
    const setup = input.setup ?? { products: ['aros'], deploymentMode: 'existing-computer', remoteCommanderAccess: false };
    if (!Array.isArray(setup.products) || setup.products.length < 1 || setup.products.length > 2
      || new Set(setup.products).size !== setup.products.length || setup.products.some(product => !['aros', 'cstoresku'].includes(product))
      || !['existing-computer', 'managed-edge'].includes(setup.deploymentMode) || typeof setup.remoteCommanderAccess !== 'boolean') throw new Error('EDGE_INVALID_SETUP');
    const activationCode = code();
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString();
    const id = await this.repository.createActivation({
      tenantId: auth.tenantId, storeId: input.storeId, connectorId: input.connectorId,
      codeHash: hashSecret(activationCode), expiresAt, setup,
    });
    return { id, activationCode, expiresAt, storeId: input.storeId, provider: 'verifone' as const };
  }

  listDevices(auth: ProvisioningAuth, storeId?: string) {
    return this.repository.listDevices(auth.tenantId, storeId);
  }

  async onboardingStatus(auth: ProvisioningAuth, storeId: string) {
    if (!await this.repository.storeExists(auth.tenantId, storeId)) throw new Error('EDGE_STORE_NOT_FOUND');
    const devices = await this.repository.listDevices(auth.tenantId, storeId);
    const device = devices.find(item => !item.revokedAt) ?? null;
    const heartbeat = device?.latestHeartbeat ?? null;
    const commanderReachable = heartbeat?.commanderReachable === true;
    const cloudConnected = device?.status === 'online' || device?.status === 'degraded';
    return {
      storeId,
      state: commanderReachable ? 'connected' : cloudConnected ? 'needs_attention' : device ? 'offline' : 'not_started',
      steps: {
        activationCreated: device ? true : await this.repository.hasUsableActivation(auth.tenantId, storeId),
        deviceEnrolled: Boolean(device), cloudConnected, commanderConnected: commanderReachable,
        initialSyncComplete: Boolean(heartbeat?.lastCloudUpload),
      },
      device,
    };
  }
}
