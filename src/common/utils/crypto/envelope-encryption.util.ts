import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DataKeyProvider } from './data-key-provider.interface.js';
import { LocalKeyProvider } from './local-key-provider.js';
import { decryptSecret as decryptSecretLegacyV1 } from './secret-box.util.js';

/**
 * ATLAS-AUDIT-012 / ATLAS-PEND-106: envelope encryption real (una data key distinta por valor
 * cifrado, envuelta por un `DataKeyProvider` intercambiable), en vez de la única clave maestra
 * reutilizada de `secret-box.util.ts`.
 *
 * NO SE CONECTÓ a `customer-onboarding.service.ts` en este patch — sigue usando
 * `secret-box.util.ts` sin cambios. Se dejó así a propósito: `secret-box.util.ts` es síncrono y
 * este módulo es asíncrono (una data key real por KMS requiere una llamada de red), así que
 * conectar esto habría significado cambiar la firma de `encryptSecret`/`decryptSecret` y tocar
 * cada call site sin poder correr una prueba real contra una base de datos en este sandbox — un
 * riesgo innecesario para código que hoy funciona. Ver `docs/architecture/assumptions.md`.
 *
 * Formato de salida: `v2:<providerId>:<keyId>:<encryptedDataKey>:<iv>:<tag>:<ciphertext>`
 * (todos los componentes binarios en base64, `encryptedDataKey` URL-encoded porque puede
 * contener `:`). `decryptSecretEnvelope` reconoce tanto este formato como el legado `v1:...` de
 * `secret-box.util.ts`, para que datos cifrados antes de este patch seguirían siendo
 * descifrables si algún día se migra el resto del código a este módulo.
 */
const defaultProvider = new LocalKeyProvider();
const providersById: Record<string, DataKeyProvider> = { local: defaultProvider };

export async function encryptSecretEnvelope(plainText: string, provider: DataKeyProvider = defaultProvider): Promise<string> {
  const dataKey = await provider.generateDataKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey.plaintextKey, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    'v2',
    provider.providerId,
    dataKey.keyId,
    encodeURIComponent(dataKey.encryptedKey),
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export async function decryptSecretEnvelope(value: string | null): Promise<string | null> {
  if (!value) return null;

  // Retrocompatibilidad con datos cifrados por secret-box.util.ts antes de este patch.
  if (value.startsWith('v1:')) {
    return decryptSecretLegacyV1(value);
  }

  try {
    const [version, providerId, keyId, encryptedKeyEncoded, ivB64, tagB64, ciphertextB64] = value.split(':');
    if (version !== 'v2' || !providerId || !keyId || !encryptedKeyEncoded || !ivB64 || !tagB64 || !ciphertextB64) {
      return null;
    }

    const provider = providersById[providerId];
    if (!provider) return null;

    const dataKey = await provider.decryptDataKey(decodeURIComponent(encryptedKeyEncoded), keyId);
    const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Registra un `DataKeyProvider` adicional (p. ej. `KmsKeyProvider` una vez conectado a AWS) para
 * que `decryptSecretEnvelope` pueda descifrar valores cifrados con él.
 */
export function registerDataKeyProvider(provider: DataKeyProvider): void {
  providersById[provider.providerId] = provider;
}
