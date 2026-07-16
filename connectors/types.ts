// ── Connector Types ─────────────────────────────────────────────

export interface ConnectorConfig {
  id: string;
  type: 'azure-db' | 'rapidrms-api' | 'verifone-commander' | 'custom';
  name: string;
  tenantId: string;
  linkedNodes: string[]; // which nodes this connector serves (e.g. ["storepulse"])
  credentials: ConnectorCredentials;
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  lastTested?: string;
}

export interface ConnectorCredentials {
  // Stored encrypted, never in plain text
  // Actual values loaded from vault at runtime only
  encrypted: true;
  vaultRef: string; // reference key in vault (not the actual value)
}

export interface AzureDbConfig {
  server: string; // e.g. yourserver.database.windows.net
  database: string;
  username: string;
  // password: NEVER stored here — vaultRef only
  port: number; // default 1433
  ssl: boolean; // always true for Azure
  encrypt: boolean; // always true for Azure
}

export interface RapidRmsApiConfig {
  baseUrl: string; // https://rapidrmsapi.azurewebsites.net
  clientId: string;
  // email + password: NEVER stored here — vaultRef only
  sessionTimeout: number; // minutes, default 420 (7h)
}

export interface ConnectorTestResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
  testedAt: string;
}

export interface AzureDbConnection {
  config: AzureDbConfig;
  pool: unknown; // mssql ConnectionPool (peer dep)
  connected: boolean;
}

export interface RapidRmsSession {
  config: RapidRmsApiConfig;
  dbName: string;
  token: string;
  cookie: string;
  expiresAt: number;
  authenticated: boolean;
}
