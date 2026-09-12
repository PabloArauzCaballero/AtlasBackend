/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de crypto sin introducir reglas de un dominio específico.
 */
import { DataEncryptionKey, DataKeyProvider } from './data-key-provider.interface.js';

type KmsCommandInput = Record<string, unknown>;

type KmsCommand = {
  input?: KmsCommandInput;
};

type KmsGenerateDataKeyResult = {
  Plaintext?: Uint8Array | Buffer;
  CiphertextBlob?: Uint8Array | Buffer;
};

type KmsDecryptResult = {
  Plaintext?: Uint8Array | Buffer;
};

type KmsClientLike = {
  send(command: KmsCommand): Promise<KmsGenerateDataKeyResult | KmsDecryptResult>;
};

type KmsSdk = {
  KMSClient: new (input: { region: string }) => KmsClientLike;
  GenerateDataKeyCommand: new (input: KmsCommandInput) => KmsCommand;
  DecryptCommand: new (input: KmsCommandInput) => KmsCommand;
};

/**
 * Proveedor opcional de AWS KMS para envelope encryption.
 *
 * El SDK se importa de forma diferida para no inicializar clientes AWS cuando KMS está apagado. El
 * paquete `@aws-sdk/client-kms` es una dependencia de producción declarada: una imagen construida
 * con `yarn install --production` puede activar KMS sin instalar componentes a mano.
 */
export class KmsKeyProvider implements DataKeyProvider {
  readonly providerId = 'kms';

  private sdkPromise?: Promise<KmsSdk>;
  private client?: KmsClientLike;

  constructor(
    private readonly kmsKeyId: string,
    private readonly region: string,
  ) {
    if (!kmsKeyId || kmsKeyId.trim().length === 0) {
      throw new Error('KmsKeyProvider requiere un kmsKeyId (ARN o alias de la CMK) no vacío.');
    }

    if (!region || region.trim().length === 0) {
      throw new Error('KmsKeyProvider requiere una región AWS no vacía.');
    }
  }

  async generateDataKey(): Promise<DataEncryptionKey> {
    const sdk = await this.loadSdk();
    const client = await this.getClient();
    const result = (await client.send(
      new sdk.GenerateDataKeyCommand({
        KeyId: this.kmsKeyId,
        KeySpec: 'AES_256',
      }),
    )) as KmsGenerateDataKeyResult;

    if (!result.Plaintext || !result.CiphertextBlob) {
      throw new Error('AWS KMS GenerateDataKeyCommand no devolvió Plaintext/CiphertextBlob. Respuesta inesperada del SDK.');
    }

    return {
      keyId: this.kmsKeyId,
      plaintextKey: Buffer.from(result.Plaintext),
      encryptedKey: Buffer.from(result.CiphertextBlob).toString('base64'),
    };
  }

  async decryptDataKey(encryptedKey: string, keyId: string): Promise<Buffer> {
    const sdk = await this.loadSdk();
    const client = await this.getClient();
    const result = (await client.send(
      new sdk.DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedKey, 'base64'),
        KeyId: keyId,
      }),
    )) as KmsDecryptResult;

    if (!result.Plaintext) {
      throw new Error('AWS KMS DecryptCommand no devolvió Plaintext. Respuesta inesperada del SDK.');
    }

    return Buffer.from(result.Plaintext);
  }

  private async getClient(): Promise<KmsClientLike> {
    if (!this.client) {
      const sdk = await this.loadSdk();
      this.client = new sdk.KMSClient({ region: this.region });
    }

    return this.client;
  }

  private async loadSdk(): Promise<KmsSdk> {
    if (!this.sdkPromise) {
      this.sdkPromise = this.importAwsKmsSdk();
    }

    return this.sdkPromise;
  }

  private async importAwsKmsSdk(): Promise<KmsSdk> {
    const packageName = '@aws-sdk/client-kms';

    try {
      return (await import(packageName)) as unknown as KmsSdk;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `AWS_KMS_SDK_UNAVAILABLE: la imagen debe incluir @aws-sdk/client-kms; si KMS no se usará, elimina KMS_KEY_ID/AWS_REGION. Detalle: ${reason}`,
        { cause: error },
      );
    }
  }
}
