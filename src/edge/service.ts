import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ActivationRequest, EventBatchRequest, HeartbeatRequest } from './contracts.js';

export interface DeviceIdentity { deviceId: string; tenantId: string; storeId: string; provider: string }
export interface Enrollment extends DeviceIdentity { tokenId: string }
export interface DeviceConfiguration {
  mode: 'read_only'; syncIntervalSeconds: number; enabledReadCapabilities: string[]; configVersion: number;
}

export interface EdgeRepository {
  consumeActivation(codeHash: string, input: ActivationRequest, deviceId: string, tokenHash: string): Promise<Enrollment | null>;
  findDeviceByToken(tokenHash: string): Promise<DeviceIdentity | null>;
  recordHeartbeat(device: DeviceIdentity, heartbeat: HeartbeatRequest): Promise<void>;
  persistBatch(device: DeviceIdentity, batch: EventBatchRequest): Promise<Array<{ eventId: string; status: 'accepted' | 'duplicate' }>>;
  getConfiguration(device: DeviceIdentity): Promise<DeviceConfiguration | null>;
}

export const hashSecret = (value: string): string => createHash('sha256').update(value).digest('hex');

export class EdgeService {
  constructor(private readonly repository: EdgeRepository) {}

  async activate(input: ActivationRequest) {
    const deviceId = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const enrollment = await this.repository.consumeActivation(hashSecret(input.activationCode), input, deviceId, hashSecret(secret));
    if (!enrollment) return null;
    return {
      apiVersion: '2026-07-15', deviceId: enrollment.deviceId, storeId: enrollment.storeId,
      tenantId: enrollment.tenantId, accessToken: `${enrollment.tokenId}.${secret}`,
      configuration: { mode: 'read_only', syncIntervalSeconds: 300 },
    };
  }

  async authenticate(accessToken: string): Promise<DeviceIdentity | null> {
    const [tokenId, secret, ...extra] = accessToken.split('.');
    if (!tokenId || !secret || extra.length) return null;
    return this.repository.findDeviceByToken(`${tokenId}:${hashSecret(secret)}`);
  }

  async heartbeat(device: DeviceIdentity, input: HeartbeatRequest) {
    await this.repository.recordHeartbeat(device, input);
    return { acceptedAt: new Date().toISOString() };
  }

  async ingest(device: DeviceIdentity, input: EventBatchRequest) {
    if (input.deviceId !== device.deviceId || input.tenantId !== device.tenantId
      || input.storeId !== device.storeId || input.provider !== device.provider) {
      throw new Error('EDGE_OWNERSHIP_MISMATCH');
    }
    const events = await this.repository.persistBatch(device, input);
    return { batchId: input.batchId, events };
  }

  async configuration(device: DeviceIdentity) {
    const configuration = await this.repository.getConfiguration(device);
    if (!configuration) throw new Error('EDGE_DEVICE_NOT_FOUND');
    return {
      mode: 'read_only' as const,
      syncIntervalSeconds: configuration.syncIntervalSeconds,
      enabledReadCapabilities: configuration.enabledReadCapabilities.filter(capability => /^[a-z][a-z0-9_-]*\.read$/.test(capability)),
      configVersion: configuration.configVersion,
    };
  }
}
