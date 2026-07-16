import { randomBytes } from 'node:crypto';
import { hashSecret } from './service.js';

export interface ProvisioningAuth { tenantId: string; userId: string; role: string }
export interface ActivationCodeInput { storeId: string; connectorId?: string; expiresInMinutes?: number }
export interface EdgeDeviceView {
  id: string; storeId: string; connectorId: string | null; provider: string; machineId: string;
  deviceName: string; operatingSystem: string | null; architecture: string | null;
  serviceVersion: string | null; connectorVersion: string | null;
  status: string; lastHeartbeatAt: string | null; createdAt: string; revokedAt: string | null;
  latestHeartbeat?: Record<string, unknown> | null;
}
export interface EdgeProvisioningRepository {
  storeExists(tenantId: string, storeId: string): Promise<boolean>;
  connectorExists(tenantId: string, storeId: string, connectorId: string): Promise<boolean>;
  createActivation(input: { tenantId: string; storeId: string; connectorId?: string; codeHash: string; expiresAt: string }): Promise<string>;
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
    const activationCode = code();
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString();
    const id = await this.repository.createActivation({
      tenantId: auth.tenantId, storeId: input.storeId, connectorId: input.connectorId,
      codeHash: hashSecret(activationCode), expiresAt,
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
    const initialSyncComplete = Boolean(heartbeat?.lastCloudUpload);
    return {
      storeId,
      state: commanderReachable && initialSyncComplete ? 'connected' : cloudConnected ? 'needs_attention' : device ? 'offline' : 'not_started',
      steps: {
        activationCreated: device ? true : await this.repository.hasUsableActivation(auth.tenantId, storeId),
        deviceEnrolled: Boolean(device), cloudConnected, commanderConnected: commanderReachable,
        initialSyncComplete,
      },
      device,
    };
  }
}
