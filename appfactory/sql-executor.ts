// ── App Factory SQL executor + role-secret vault (Phase 2) ──────────────────
// Privileged Postgres executor that runs the provisioning DDL (CREATE SCHEMA /
// ROLE) for a generated app, plus the file-vault write for the generated role
// password. Both are config-gated: when no provisioning DB is configured the
// executor is null and the endpoint degrades to 501 — the same "operator must
// wire this" posture as the staged-apply tenant_apps migration.
//
// Connection + secret file conventions mirror connectors/rapidrms/
// analytics-connector.ts (pg Pool from ~/.shre/vault/*.json).

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SqlExecutor } from './types.js';

// pg ships no bundled types in this workspace (same as connectors/rapidrms/
// analytics-connector.ts); load it via require so tsc needs no @types/pg.
const nodeRequire = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pg: any = nodeRequire('pg');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharedPool: any = null;

interface DbVaultFile {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

/** Resolve the privileged provisioning connection string, or null if unset.
 *  Order: APP_FACTORY_DATABASE_URL, then ~/.shre/vault/app-factory-db.json. */
function loadConnectionString(): string | null {
  if (process.env.APP_FACTORY_DATABASE_URL?.trim()) return process.env.APP_FACTORY_DATABASE_URL.trim();
  const vaultFile = join(homedir(), '.shre', 'vault', 'app-factory-db.json');
  try {
    if (existsSync(vaultFile)) {
      const creds = JSON.parse(readFileSync(vaultFile, 'utf8')) as DbVaultFile;
      if (creds.connectionString) return creds.connectionString;
      if (creds.host && creds.user) {
        const auth = `${encodeURIComponent(creds.user)}:${encodeURIComponent(creds.password ?? '')}`;
        return `postgresql://${auth}@${creds.host}:${creds.port ?? 5432}/${creds.database ?? 'postgres'}`;
      }
    }
  } catch { /* fall through to null */ }
  return null;
}

/**
 * A privileged SqlExecutor for App Factory provisioning DDL, or null when no
 * provisioning DB is configured (the caller then returns 501). Uses the simple
 * query protocol so multi-statement DDL (incl. DO $$ blocks) runs in one call.
 */
export function createProvisioningSqlExecutor(): SqlExecutor | null {
  const conn = loadConnectionString();
  if (!conn) return null;
  if (!sharedPool) {
    sharedPool = new pg.Pool({ connectionString: conn, max: 3, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
    sharedPool.on('error', (err: Error) => console.error('[appfactory.sql] pool error:', err.message));
  }
  const pool = sharedPool;
  return {
    async exec(sql: string): Promise<void> {
      await pool.query(sql);
    },
  };
}

/**
 * Persist a generated app's role credential to the file-vault
 * (~/.shre/vault/app-<subdomain>.json, 0600). The password is returned once by
 * provisionApp and MUST NOT travel back over the API — this is where it lands.
 */
export function storeRoleSecret(
  subdomain: string,
  payload: { role: string; password: string; schema: string; tenantId: string },
): string {
  const dir = join(homedir(), '.shre', 'vault');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `app-${subdomain}.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return file;
}
