import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../../config/env.js';
import { DataEncryptionKey, DataKeyProvider } from './data-key-provider.interface.js';

function deriveMasterKey(): Buffer {
  const raw = env.NOTIFICATION_TOKEN_ENCRYPTION_KEY ?? env.JWT_ACCESS_TOKEN_SECRET;
  return createHash('sha256').update(raw).digest();
}

/**
 * Implementación de `DataKeyProvider` que NO usa un KMS real: genera una data key aleatoria por
 * valor cifrado (correcto, a diferencia del esquema anterior de una sola clave maestra
 * reutilizada) y la "envuelve" cifrándola con una clave maestra derivada localmente de una
 * variable de entorno — la misma limitación de fondo que ya tenía `secret-box.util.ts`
 * (comprometer la variable de entorno compromete todo lo cifrado con este proveedor).
 *
 * El valor de este archivo no es hacer el cifrado "más fuerte" hoy — es dejar el FORMATO de los
 * datos ya listo para envelope encryption real: cuando `KmsKeyProvider` esté conectado a AWS
 * KMS, migrar consiste en cambiar qué `DataKeyProvider` se inyecta, no en re-diseñar el formato
 * de almacenamiento ni migrar datos existentes con otro esquema.
 */
export class LocalKeyProvider implements DataKeyProvider {
  readonly providerId = 'local';

  async generateDataKey(): Promise<DataEncryptionKey> {
    const plaintextKey = randomBytes(32);
    const masterKey = deriveMasterKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encryptedKey = `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
    return { keyId: 'local-v1', plaintextKey, encryptedKey };
  }

  async decryptDataKey(encryptedKey: string, keyId: string): Promise<Buffer> {
    if (keyId !== 'local-v1') {
      throw new Error(`LocalKeyProvider no reconoce keyId "${keyId}".`);
    }
    const [ivB64, tagB64, encryptedB64] = encryptedKey.split(':');
    if (!ivB64 || !tagB64 || !encryptedB64) {
      throw new Error('encryptedKey con formato inválido para LocalKeyProvider.');
    }
    const masterKey = deriveMasterKey();
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedB64, 'base64')), decipher.final()]);
  }
}
