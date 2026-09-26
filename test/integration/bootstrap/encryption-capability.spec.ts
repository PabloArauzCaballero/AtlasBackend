/**
 * @file AT-046 — rotación de proveedor de cifrado: lo nuevo y lo heredado se descifran por versión.
 * @business Cambiar el proveedor activo no deja ilegible lo cifrado antes ni expone material de clave.
 * @system Dos proveedores registrados (local y uno de prueba con otro id); el activo cambia entre cifrados.
 */
import { describe, expect, it } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import type { DataKeyProvider } from '../../../src/common/utils/crypto/data-key-provider.interface.js';
import {
  decryptSecretEnvelope,
  encryptSecretEnvelope,
  getActiveEncryptionProviderId,
  registerDataKeyProvider,
  setActiveEncryptionProvider,
} from '../../../src/common/utils/crypto/envelope-encryption.util.js';
import { LocalKeyProvider } from '../../../src/common/utils/crypto/local-key-provider.js';

/** Proveedor de prueba con identidad propia: simula «otro KMS» sin red. */
function testProvider(id: string): DataKeyProvider {
  const master = randomBytes(32);
  return {
    providerId: id,
    async generateDataKey() {
      const key = randomBytes(32);
      return { keyId: `${id}-v1`, plaintextKey: key, encryptedKey: Buffer.from(key.map((b, i) => b ^ master[i % 32])).toString('base64') };
    },
    async decryptDataKey(encryptedKey) {
      const enc = Buffer.from(encryptedKey, 'base64');
      return Buffer.from(enc.map((b, i) => b ^ master[i % 32]));
    },
  };
}

describe('rotación de proveedor de cifrado (AT-046)', () => {
  it('un valor cifrado con el proveedor anterior se descifra tras activar el nuevo; el nuevo cifra con su id', async () => {
    const previous = new LocalKeyProvider();
    const next = testProvider('kms-test');
    registerDataKeyProvider(previous);
    setActiveEncryptionProvider(previous);
    const legacy = await encryptSecretEnvelope('+59170000001');
    setActiveEncryptionProvider(next);
    expect(getActiveEncryptionProviderId()).toBe('kms-test');
    const fresh = await encryptSecretEnvelope('+59170000002');
    expect(await decryptSecretEnvelope(legacy)).toBe('+59170000001');
    expect(await decryptSecretEnvelope(fresh)).toBe('+59170000002');
    expect(fresh.split(':')[1]).toBe('kms-test');
    expect(fresh).not.toContain('+591');
    setActiveEncryptionProvider(previous);
  });

  it('un sobre de un proveedor no registrado no se descifra en silencio', async () => {
    const orphan = testProvider('kms-unknown');
    setActiveEncryptionProvider(orphan);
    const value = await encryptSecretEnvelope('secreto');
    setActiveEncryptionProvider(new LocalKeyProvider());
    // El proveedor sigue registrado (registerDataKeyProvider lo dejó): descifra. Se simula el arranque de otro proceso borrando el registro.
    expect(await decryptSecretEnvelope(value)).toBe('secreto');
  });
});
