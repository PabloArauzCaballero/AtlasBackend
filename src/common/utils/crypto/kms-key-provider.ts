import { DataEncryptionKey, DataKeyProvider } from './data-key-provider.interface.js';

/**
 * ATLAS-PEND-106: punto de integración documentado para AWS KMS real. NO se conecta a AWS en
 * este patch — agregar la dependencia `@aws-sdk/client-kms` y credenciales de infraestructura
 * es una decisión de despliegue/infraestructura, fuera del alcance de un patch de código escrito
 * sin acceso a AWS real para probarlo. Lanza un error explícito si se intenta usar sin haber
 * completado la integración, en vez de fallar en silencio o simular un cifrado que no es real.
 *
 * Integración pendiente (dejar aquí cuando se implemente):
 *
 * ```ts
 * import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';
 *
 * export class KmsKeyProvider implements DataKeyProvider {
 *   readonly providerId = 'kms';
 *   private readonly client: KMSClient;
 *   constructor(private readonly kmsKeyId: string, region: string) {
 *     this.client = new KMSClient({ region });
 *   }
 *
 *   async generateDataKey(): Promise<DataEncryptionKey> {
 *     const result = await this.client.send(new GenerateDataKeyCommand({
 *       KeyId: this.kmsKeyId,
 *       KeySpec: 'AES_256',
 *     }));
 *     return {
 *       keyId: this.kmsKeyId,
 *       plaintextKey: Buffer.from(result.Plaintext!),
 *       encryptedKey: Buffer.from(result.CiphertextBlob!).toString('base64'),
 *     };
 *   }
 *
 *   async decryptDataKey(encryptedKey: string, keyId: string): Promise<Buffer> {
 *     const result = await this.client.send(new DecryptCommand({
 *       CiphertextBlob: Buffer.from(encryptedKey, 'base64'),
 *       KeyId: keyId,
 *     }));
 *     return Buffer.from(result.Plaintext!);
 *   }
 * }
 * ```
 */
export class KmsKeyProvider implements DataKeyProvider {
  readonly providerId = 'kms';

  generateDataKey(): Promise<DataEncryptionKey> {
    throw new Error(
      'KmsKeyProvider no está conectado a AWS KMS todavía (ATLAS-PEND-106). Ver el comentario de este archivo para el código de integración exacto, y docs/architecture/assumptions.md.',
    );
  }

  decryptDataKey(): Promise<Buffer> {
    throw new Error(
      'KmsKeyProvider no está conectado a AWS KMS todavía (ATLAS-PEND-106). Ver el comentario de este archivo para el código de integración exacto, y docs/architecture/assumptions.md.',
    );
  }
}
