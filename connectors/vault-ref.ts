// ── Vault Reference Manager ─────────────────────────────────────
// Credentials are NEVER stored in plain text. This module handles
// encryption, storage, and retrieval via vault references.

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';

// ── Constants ───────────────────────────────────────────────────

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;
const SALT_LEN = 32;
const KEY_LEN = 32;

// ── In-memory vault (swap for persistent store in production) ───

const vault = new Map<string, Buffer>();

// ── Key Derivation ──────────────────────────────────────────────

let _tenantSecret: string | undefined;

/**
 * The secret each ref was ENCRYPTED with, bound at store time. Concurrent
 * requests for different tenants interleave at await points — deriving the
 * decrypt key from whatever the module-global holds at RETRIEVE time decrypts
 * with the wrong tenant's key (GCM auth failure) whenever another request has
 * called setTenantSecret() in between. The binding makes each ref
 * self-contained regardless of interleaving.
 */
const refSecrets = new Map<string, string>();

/**
 * Set the ambient per-tenant secret for key derivation. Interleaving hazard:
 * prefer passing the secret explicitly to storeCredential — the ambient value
 * is only safe when set in the same synchronous block as the store call.
 */
export function setTenantSecret(secret: string): void {
  _tenantSecret = secret;
}

function requireSecret(explicit?: string): string {
  const secret = explicit ?? _tenantSecret;
  if (!secret) throw new Error('Tenant secret not set — pass tenantSecret or call setTenantSecret() first');
  return secret;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Encrypt value, store in vault, return vaultRef (not the value).
 * Pass tenantSecret explicitly whenever the call may follow an await —
 * the ambient setTenantSecret() value can belong to another request by then.
 */
export async function storeCredential(key: string, value: string, tenantSecret?: string): Promise<string> {
  const secret = requireSecret(tenantSecret);
  const salt = randomBytes(SALT_LEN);
  const derivedKey = scryptSync(secret, salt, KEY_LEN);
  const iv = randomBytes(IV_LEN);

  const cipher = createCipheriv(ALGO, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Pack: salt + iv + tag + ciphertext
  const packed = Buffer.concat([salt, iv, tag, encrypted]);
  const ref = `vault:${key}:${randomBytes(8).toString('hex')}`;

  vault.set(ref, packed);
  refSecrets.set(ref, secret);
  return ref;
}

/** Decrypt and return value (in-memory only, never logged). */
export async function retrieveCredential(vaultRef: string): Promise<string> {
  const packed = vault.get(vaultRef);
  if (!packed) throw new Error(`Vault ref not found: ${vaultRef}`);

  const salt = packed.subarray(0, SALT_LEN);
  const iv = packed.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = packed.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ciphertext = packed.subarray(SALT_LEN + IV_LEN + TAG_LEN);

  // Decrypt with the secret the ref was stored under — never the ambient
  // global, which may belong to a concurrent request's tenant by now.
  const derivedKey = scryptSync(requireSecret(refSecrets.get(vaultRef)), salt, KEY_LEN);
  const decipher = createDecipheriv(ALGO, derivedKey, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/** Delete credential from vault. */
export async function deleteCredential(vaultRef: string): Promise<void> {
  vault.delete(vaultRef);
  refSecrets.delete(vaultRef);
}

/** Rotate: delete old, store new value under same key prefix and same secret. */
export async function rotateCredential(vaultRef: string, newValue: string): Promise<string> {
  // Extract key name from ref
  const parts = vaultRef.split(':');
  const key = parts[1] ?? 'rotated';

  const secret = refSecrets.get(vaultRef);
  await deleteCredential(vaultRef);
  return storeCredential(key, newValue, secret);
}
