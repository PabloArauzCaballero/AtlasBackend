/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de crypto sin introducir reglas de un dominio específico.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../../config/env.js';
import { DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY } from '../../../config/env.schema.js';
import { DataEncryptionKey, DataKeyProvider } from './data-key-provider.interface.js';

/**
 * Claves maestras con las que se puede ABRIR un sobre, en orden: la vigente primero.
 *
 * Con UNA sola, cambiar la variable —rotarla, regenerarla en un despliegue, sustituir el JWT del que
 * caía de reserva— dejaba ilegible toda la PII ya guardada, y de forma SILENCIOSA: el descifrado
 * devuelve `null` y cada llamador lo trata a su manera (el código de verificación del alta no sale,
 * la recuperación de PIN no encuentra correo, la reserva por SMS no tiene a dónde ir). Medido en TEST
 * el 2026-10-06: un cliente cuyo correo se cifró por la mañana dejó de poder recibir su código por la
 * tarde, con Gmail funcionando.
 *
 * El cifrado SIEMPRE usa la primera. Las demás sólo sirven para leer: un sobre cifrado con la clave
 * equivocada falla en la autenticación de GCM, así que probarlas es seguro y no puede devolver un
 * texto distinto del original.
 */
export function masterKeyCandidates(): Buffer[] {
  const raws = [
    env.NOTIFICATION_TOKEN_ENCRYPTION_KEY,
    env.JWT_ACCESS_TOKEN_SECRET,
    ...(env.NOTIFICATION_TOKEN_ENCRYPTION_PREVIOUS_KEYS ?? '').split(','),
    // La de reserva con la que arranca un entorno al que se le olvidó definir la variable.
    DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY,
  ]
    .map((raw) => raw?.trim())
    .filter((raw): raw is string => Boolean(raw));
  return [...new Set(raws)].map((raw) => createHash('sha256').update(raw).digest());
}

function deriveMasterKey(): Buffer {
  return masterKeyCandidates()[0] as Buffer;
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
    let lastError: unknown = new Error('Sin claves maestras.');
    for (const masterKey of masterKeyCandidates()) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(encryptedB64, 'base64')), decipher.final()]);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}
