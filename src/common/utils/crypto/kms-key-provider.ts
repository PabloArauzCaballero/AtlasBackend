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
 * Importante para desarrollo local: este archivo no importa `@aws-sdk/client-kms` de forma
 * estática. Así el backend compila y arranca aunque el SDK de AWS no esté instalado, siempre que
 * KMS no esté configurado en `.env`. En producción, si se define `KMS_KEY_ID` + `AWS_REGION`, el
 * paquete `@aws-sdk/client-kms` debe estar instalado en la imagen final.
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
        `AWS_KMS_SDK_NOT_INSTALLED: instala @aws-sdk/client-kms para usar KMS real o elimina KMS_KEY_ID/AWS_REGION del entorno local. Detalle: ${reason}`,
      );
    }
  }
}
