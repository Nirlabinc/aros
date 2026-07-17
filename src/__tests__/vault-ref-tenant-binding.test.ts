import { describe, it, expect } from 'vitest';
import {
  setTenantSecret,
  storeCredential,
  retrieveCredential,
  rotateCredential,
  deleteCredential,
} from '../../connectors/vault-ref.js';

// Regression: refs must decrypt with the secret they were STORED under, even
// when a concurrent request has since re-pointed the ambient tenant secret.
// Before the per-ref binding, this decrypted with tenant B's key and threw a
// GCM auth failure (or worse, would return garbage if auth were absent).

describe('vault-ref tenant binding', () => {
  it('retrieves with the store-time secret despite ambient secret changing', async () => {
    setTenantSecret('tenant-A-secret');
    const ref = await storeCredential('conn-1:password', 'hunter2', 'tenant-A-secret');

    // Concurrent request for another tenant interleaves:
    setTenantSecret('tenant-B-secret');

    await expect(retrieveCredential(ref)).resolves.toBe('hunter2');
    await deleteCredential(ref);
  });

  it('explicit secret wins over ambient at store time', async () => {
    setTenantSecret('ambient-wrong');
    const ref = await storeCredential('conn-2:password', 's3cret', 'explicit-right');
    setTenantSecret('another-tenant');
    await expect(retrieveCredential(ref)).resolves.toBe('s3cret');
    await deleteCredential(ref);
  });

  it('rotation preserves the original tenant binding', async () => {
    const ref = await storeCredential('conn-3:password', 'old-value', 'tenant-C-secret');
    setTenantSecret('tenant-D-secret');
    const newRef = await rotateCredential(ref, 'new-value');
    await expect(retrieveCredential(newRef)).resolves.toBe('new-value');
    await expect(retrieveCredential(ref)).rejects.toThrow('Vault ref not found');
    await deleteCredential(newRef);
  });

  it('deleted refs drop their binding and are unretrievable', async () => {
    const ref = await storeCredential('conn-4:password', 'x', 'tenant-E-secret');
    await deleteCredential(ref);
    await expect(retrieveCredential(ref)).rejects.toThrow('Vault ref not found');
  });
});
