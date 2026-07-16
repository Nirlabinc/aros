export type StoredTransaction = { verifier: string; nonce: string; returnTo: string; expiresAt: number };
export type StoredSession = { subject: string; workspaceId: string; role: string; claims: Record<string, unknown>; refreshToken?: string; expiresAt: number };

export interface OidcStore {
  putTransaction(stateHash: string, browserHash: string, value: StoredTransaction): Promise<void>;
  consumeTransaction(stateHash: string, browserHash: string, now: number): Promise<StoredTransaction | null>;
  putSession(sessionHash: string, value: StoredSession): Promise<void>;
  getSession(sessionHash: string, now: number): Promise<StoredSession | null>;
  revokeSession(sessionHash: string): Promise<StoredSession | null>;
  cleanup(now: number): Promise<void>;
}

export function createMemoryOidcStore(): OidcStore {
  const transactions = new Map<string, { browserHash: string; value: StoredTransaction }>();
  const sessions = new Map<string, StoredSession>();
  return {
    async putTransaction(hash, browserHash, value) { transactions.set(hash, { browserHash, value }); },
    async consumeTransaction(hash, browserHash, now) { const row = transactions.get(hash); if (!row || row.browserHash !== browserHash || row.value.expiresAt <= now) return null; transactions.delete(hash); return row.value; },
    async putSession(hash, value) { sessions.set(hash, value); },
    async getSession(hash, now) { const value = sessions.get(hash); if (!value || value.expiresAt <= now) { sessions.delete(hash); return null; } return value; },
    async revokeSession(hash) { const value = sessions.get(hash) || null; sessions.delete(hash); return value; },
    async cleanup(now) { for (const [key, row] of transactions) if (row.value.expiresAt <= now) transactions.delete(key); for (const [key, row] of sessions) if (row.expiresAt <= now) sessions.delete(key); },
  };
}

type SupabaseLike = { from(table: string): any; rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };
export function createSupabaseOidcStore(db: SupabaseLike, crypto: { seal(value: string): string; open(value: string): string }): OidcStore {
  const decode = <T>(sealed: string): T => JSON.parse(crypto.open(sealed)) as T;
  return {
    async putTransaction(hash, browserHash, value) { const { error } = await db.from('oidc_rp_transactions').insert({ state_hash: hash, browser_hash: browserHash, sealed_payload: crypto.seal(JSON.stringify(value)), expires_at: new Date(value.expiresAt).toISOString() }); if (error) throw new Error(`OIDC transaction persistence failed: ${error.message}`); },
    async consumeTransaction(hash, browserHash) { const { data, error } = await db.rpc('consume_oidc_rp_transaction', { p_state_hash: hash, p_browser_hash: browserHash }); if (error) throw new Error(`OIDC transaction consume failed: ${error.message}`); const sealed = data?.[0]?.sealed_payload; return sealed ? decode<StoredTransaction>(sealed) : null; },
    async putSession(hash, value) { const { error } = await db.from('oidc_rp_sessions').insert({ session_hash: hash, subject: value.subject, workspace_id: value.workspaceId, role: value.role, sealed_payload: crypto.seal(JSON.stringify({ claims: value.claims, refreshToken: value.refreshToken })), expires_at: new Date(value.expiresAt).toISOString() }); if (error) throw new Error(`OIDC session persistence failed: ${error.message}`); },
    async getSession(hash, now) { const { data, error } = await db.from('oidc_rp_sessions').select('subject,workspace_id,role,sealed_payload,expires_at').eq('session_hash', hash).is('revoked_at', null).gt('expires_at', new Date(now).toISOString()).maybeSingle(); if (error) throw new Error(`OIDC session lookup failed: ${error.message}`); if (!data) return null; const secret = decode<{ claims: Record<string, unknown>; refreshToken?: string }>(data.sealed_payload); return { subject: data.subject, workspaceId: data.workspace_id, role: data.role, expiresAt: new Date(data.expires_at).getTime(), ...secret }; },
    async revokeSession(hash) { const { data: existing, error: loadError } = await db.from('oidc_rp_sessions').select('subject,workspace_id,role,sealed_payload,expires_at').eq('session_hash', hash).is('revoked_at', null).maybeSingle(); if (loadError) throw new Error(`OIDC session revoke lookup failed: ${loadError.message}`); if (!existing) return null; const { error } = await db.from('oidc_rp_sessions').update({ revoked_at: new Date().toISOString() }).eq('session_hash', hash).is('revoked_at', null); if (error) throw new Error(`OIDC session revoke failed: ${error.message}`); const secret = decode<{ claims: Record<string, unknown>; refreshToken?: string }>(existing.sealed_payload); return { subject: existing.subject, workspaceId: existing.workspace_id, role: existing.role, expiresAt: new Date(existing.expires_at).getTime(), ...secret }; },
    async cleanup() { const { error } = await db.rpc('cleanup_oidc_rp_state'); if (error) throw new Error(`OIDC cleanup failed: ${error.message}`); },
  };
}
