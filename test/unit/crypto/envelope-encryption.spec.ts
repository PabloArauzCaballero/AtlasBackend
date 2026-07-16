import { afterEach, describe, expect, it } from '@jest/globals';
import {
  decryptSecretEnvelope,
  encryptSecretEnvelope,
  getActiveEncryptionProviderId,
  registerDataKeyProvider,
  setActiveEncryptionProvider,
} from '../../../src/common/utils/crypto/envelope-encryption.util.js';
import { LocalKeyProvider } from '../../../src/common/utils/crypto/local-key-provider.js';
import { DataEncryptionKey, DataKeyProvider } from '../../../src/common/utils/crypto/data-key-provider.interface.js';
import { encryptSecret } from '../../../src/common/utils/crypto/secret-box.util.js';
import { randomBytes } from 'node:crypto';

/**
 * Proveedor falso que imita a KMS sin llamar a AWS: envuelve la data key con un XOR trivial. Sirve
 * para probar el cableado del "proveedor activo" (Fase 3.3) de forma determinista y offline.
 */
class FakeKmsProvider implements DataKeyProvider {
  readonly providerId = 'kms';
  private readonly master = randomBytes(32);
  generateDataKeyCalls = 0;

  async generateDataKey(): Promise<DataEncryptionKey> {
    this.generateDataKeyCalls += 1;
    const plaintextKey = randomBytes(32);
    return {
      keyId: 'fake-kms-key',
      plaintextKey,
      encryptedKey: this.wrap(plaintextKey).toString('base64'),
    };
  }

  async decryptDataKey(encryptedKey: string): Promise<Buffer> {
    return this.wrap(Buffer.from(encryptedKey, 'base64'));
  }

  private wrap(buf: Buffer): Buffer {
    return Buffer.from(buf.map((byte, i) => byte ^ this.master[i % this.master.length]));
  }
}

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

  describe('proveedor de cifrado activo (Fase 3.3: cableado de KMS)', () => {
    // Restaura el default `local` tras cada test para no filtrar estado entre specs.
    afterEach(() => {
      setActiveEncryptionProvider(new LocalKeyProvider());
    });

    it('el proveedor activo por defecto es `local`', () => {
      expect(getActiveEncryptionProviderId()).toBe('local');
    });

    it('al activar KMS, las escrituras nuevas se cifran con `kms` sin cambiar el call site', async () => {
      const kms = new FakeKmsProvider();
      setActiveEncryptionProvider(kms);

      expect(getActiveEncryptionProviderId()).toBe('kms');
      const encrypted = await encryptSecretEnvelope('+59171234567');
      expect(encrypted.startsWith('v2:kms:')).toBe(true);
      expect(kms.generateDataKeyCalls).toBe(1);
      await expect(decryptSecretEnvelope(encrypted)).resolves.toBe('+59171234567');
    });

    it('valores previos cifrados con `local` se siguen descifrando tras activar KMS', async () => {
      // Cifra con `local` (default), luego conmuta a KMS: el valor viejo debe seguir legible.
      const encryptedWithLocal = await encryptSecretEnvelope('demo@atlas.test');
      expect(encryptedWithLocal.startsWith('v2:local:')).toBe(true);

      setActiveEncryptionProvider(new FakeKmsProvider());
      await expect(decryptSecretEnvelope(encryptedWithLocal)).resolves.toBe('demo@atlas.test');
    });

    it('un proveedor solo registrado (no activado) descifra pero no se vuelve el de cifrado', async () => {
      registerDataKeyProvider(new FakeKmsProvider());
      // Sigue cifrando con `local` porque `registerDataKeyProvider` no cambia el proveedor activo.
      const encrypted = await encryptSecretEnvelope('registered-not-active');
      expect(encrypted.startsWith('v2:local:')).toBe(true);
    });
  });
});
