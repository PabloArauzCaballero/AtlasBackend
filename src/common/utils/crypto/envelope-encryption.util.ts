import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DataKeyProvider } from './data-key-provider.interface.js';
import { LocalKeyProvider } from './local-key-provider.js';
import { decryptSecret as decryptSecretLegacyV1 } from './secret-box.util.js';

/**
 * Envelope encryption con una data key por valor y proveedor de claves intercambiable.
 *
 * Formato de salida: `v2:<providerId>:<keyId>:<encryptedDataKey>:<iv>:<tag>:<ciphertext>`.
 * `decryptSecretEnvelope` también reconoce el formato legado `v1:...` de `secret-box.util.ts`.
 */
const defaultProvider = new LocalKeyProvider();
const providersById: Record<string, DataKeyProvider> = { local: defaultProvider };

// Proveedor ACTIVO de cifrado: el que usan por defecto los call sites (`encryptSecretEnvelope(x)`
// sin segundo argumento). Arranca en `local` — el default seguro para desarrollo/test y para
// cualquier entorno que no configure KMS. `setActiveEncryptionProvider` lo conmuta a `kms` en
// `main.ts` cuando `KMS_KEY_ID`+`AWS_REGION` están presentes (Fase 3.3 del plan 10/10). El
// descifrado no depende de esto: usa el `providerId` embebido en cada valor, así que datos
// cifrados con `local` siguen descifrándose aunque el proveedor activo sea `kms`, y viceversa.
let activeEncryptionProvider: DataKeyProvider = defaultProvider;

export async function encryptSecretEnvelope(plainText: string, provider: DataKeyProvider = activeEncryptionProvider): Promise<string> {
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

  // Retrocompatibilidad con datos cifrados por secret-box.util.ts.
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
 * que `decryptSecretEnvelope` pueda descifrar valores cifrados con él. Registrar un proveedor NO
 * lo vuelve el proveedor de CIFRADO por defecto; para eso usa `setActiveEncryptionProvider`.
 */
export function registerDataKeyProvider(provider: DataKeyProvider): void {
  providersById[provider.providerId] = provider;
}

/**
 * Conmuta el proveedor ACTIVO de cifrado (el que usan los call sites sin argumento). Registra
 * también el proveedor para descifrado por conveniencia. Llamado en `main.ts` cuando KMS está
 * configurado, de modo que en producción las escrituras nuevas de PII se cifren con KMS real sin
 * tocar ningún call site. Es idempotente.
 */
export function setActiveEncryptionProvider(provider: DataKeyProvider): void {
  registerDataKeyProvider(provider);
  activeEncryptionProvider = provider;
}

/** Devuelve el `providerId` del proveedor de cifrado activo (`local` | `kms`). Útil para logs/observabilidad. */
export function getActiveEncryptionProviderId(): string {
  return activeEncryptionProvider.providerId;
}
