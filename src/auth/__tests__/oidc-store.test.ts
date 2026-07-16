import { describe, expect, it } from 'vitest';
import { createMemoryOidcStore, createSupabaseOidcStore } from '../oidc-store';

describe('OIDC durable store contract', () => {
  it('allows exactly one concurrent transaction consumer', async () => {
    const store = createMemoryOidcStore(); await store.putTransaction('state', 'browser', { verifier: 'v', nonce: 'n', returnTo: '/', expiresAt: 200 });
    const results = await Promise.all(Array.from({ length: 20 }, () => store.consumeTransaction('state', 'browser', 100)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('rejects wrong-browser replay and expired state', async () => {
    const store = createMemoryOidcStore(); await store.putTransaction('one', 'browser', { verifier: 'v', nonce: 'n', returnTo: '/', expiresAt: 20 });
    expect(await store.consumeTransaction('one', 'wrong', 10)).toBeNull(); expect(await store.consumeTransaction('one', 'browser', 21)).toBeNull();
  });
  it('expires and revokes sessions', async () => {
    const store = createMemoryOidcStore(); const value = { subject: 'u', workspaceId: 'w', role: 'owner', claims: {}, expiresAt: 20 };
    await store.putSession('live', { ...value, expiresAt: 30 }); await store.putSession('old', value);
    expect(await store.getSession('old', 21)).toBeNull(); expect(await store.revokeSession('live')).toMatchObject({ subject: 'u' }); expect(await store.getSession('live', 10)).toBeNull();
  });
  it('seals database payloads and consumes through the atomic RPC', async () => {
    const calls: Array<{ table?: string; value?: any; rpc?: string; args?: any }> = [];
    const seal = (value: string) => Buffer.from(value).toString('base64'); const open = (value: string) => Buffer.from(value, 'base64').toString();
    const db = { from(table: string) { return { insert(value: any) { calls.push({ table, value }); return Promise.resolve({ error: null }); } }; }, rpc(name: string, args: any) { calls.push({ rpc: name, args }); return Promise.resolve({ data: [{ sealed_payload: seal(JSON.stringify({ verifier: 'v', nonce: 'n', returnTo: '/', expiresAt: 20 })) }], error: null }); } };
    const store = createSupabaseOidcStore(db as any, { seal, open });
    await store.putTransaction('hash', 'browser-hash', { verifier: 'secret', nonce: 'nonce', returnTo: '/', expiresAt: 20 });
    expect(JSON.stringify(calls[0].value)).not.toContain('secret');
    expect(await store.consumeTransaction('hash', 'browser-hash', 1)).toMatchObject({ verifier: 'v' });
    expect(calls[1]).toMatchObject({ rpc: 'consume_oidc_rp_transaction', args: { p_state_hash: 'hash', p_browser_hash: 'browser-hash' } });
  });
});
