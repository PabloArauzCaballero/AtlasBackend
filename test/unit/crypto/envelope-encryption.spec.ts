import { describe, expect, it } from '@jest/globals';
import { decryptSecretEnvelope, encryptSecretEnvelope } from '../../../src/common/utils/crypto/envelope-encryption.util.js';
import { encryptSecret } from '../../../src/common/utils/crypto/secret-box.util.js';

describe('envelope-encryption.util', () => {
  it('round-trips a plain text value through encrypt/decrypt', async () => {
    const encrypted = await encryptSecretEnvelope('+59170000000');
    expect(encrypted.startsWith('v2:local:')).toBe(true);
    await expect(decryptSecretEnvelope(encrypted)).resolves.toBe('+59170000000');
  });

  it('uses a different data key (and therefore different ciphertext) for each call, even for the same plaintext', async () => {
    const a = await encryptSecretEnvelope('demo@atlas.test');
    const b = await encryptSecretEnvelope('demo@atlas.test');
    expect(a).not.toBe(b);
  });

  it('returns null for null input', async () => {
    await expect(decryptSecretEnvelope(null)).resolves.toBeNull();
  });

  it('returns null for a corrupted/malformed value instead of throwing', async () => {
    await expect(decryptSecretEnvelope('not-a-real-envelope-value')).resolves.toBeNull();
  });

  it('remains backward-compatible with values encrypted by the legacy secret-box.util.ts (v1 format)', async () => {
    const legacyEncrypted = encryptSecret('legacy-value-encrypted-before-this-patch');
    expect(legacyEncrypted.startsWith('v1:')).toBe(true);
    await expect(decryptSecretEnvelope(legacyEncrypted)).resolves.toBe('legacy-value-encrypted-before-this-patch');
  });
});
