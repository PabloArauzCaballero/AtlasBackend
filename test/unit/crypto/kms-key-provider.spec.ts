import { describe, expect, it, jest, beforeEach } from '@jest/globals';

/**
 * ATLAS-P11-T06 (cubre el código nuevo de ATLAS-P11-T13): valida que `KmsKeyProvider` traduce
 * correctamente entre el contrato `DataKeyProvider` y las respuestas del SDK de AWS KMS, sin
 * necesitar credenciales ni red reales — el cliente `KMSClient` se reemplaza por un mock. Esto
 * NO reemplaza la verificación end-to-end contra un KMS real de staging que sigue pendiente
 * (ver la nota de alcance en `kms-key-provider.ts`); cubre la lógica de traducción de formatos
 * que sí se puede verificar por completo en este sandbox.
 */
const sendMock = jest.fn();

jest.mock(
  '@aws-sdk/client-kms',
  () => {
    return {
      KMSClient: jest.fn().mockImplementation(() => ({ send: sendMock })),
      GenerateDataKeyCommand: jest.fn().mockImplementation((input: unknown) => ({ __command: 'GenerateDataKeyCommand', input })),
      DecryptCommand: jest.fn().mockImplementation((input: unknown) => ({ __command: 'DecryptCommand', input })),
    };
  },
  { virtual: true },
);

describe('KmsKeyProvider', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('throws immediately if constructed with an empty kmsKeyId, before any AWS call', async () => {
    const { KmsKeyProvider } = await import('../../../src/common/utils/crypto/kms-key-provider.js');
    expect(() => new KmsKeyProvider('', 'us-east-1')).toThrow(/kmsKeyId/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('generateDataKey() maps GenerateDataKeyCommand output to DataEncryptionKey', async () => {
    const { KmsKeyProvider } = await import('../../../src/common/utils/crypto/kms-key-provider.js');
    sendMock.mockResolvedValueOnce({
      Plaintext: Buffer.from('plaintext-data-key-32-bytes-long'),
      CiphertextBlob: Buffer.from('wrapped-key-bytes'),
    } as never);

    const provider = new KmsKeyProvider('arn:aws:kms:us-east-1:111111111111:key/test-key', 'us-east-1');
    const result = await provider.generateDataKey();

    expect(result.keyId).toBe('arn:aws:kms:us-east-1:111111111111:key/test-key');
    expect(result.plaintextKey.toString()).toBe('plaintext-data-key-32-bytes-long');
    expect(result.encryptedKey).toBe(Buffer.from('wrapped-key-bytes').toString('base64'));
  });

  it('generateDataKey() throws a clear error when AWS returns an unexpected empty response', async () => {
    const { KmsKeyProvider } = await import('../../../src/common/utils/crypto/kms-key-provider.js');
    sendMock.mockResolvedValueOnce({} as never);
    const provider = new KmsKeyProvider('alias/atlas-pii', 'us-east-1');
    await expect(provider.generateDataKey()).rejects.toThrow(/GenerateDataKeyCommand/);
  });

  it('decryptDataKey() sends the base64-decoded ciphertext and returns the plaintext buffer', async () => {
    const { KmsKeyProvider } = await import('../../../src/common/utils/crypto/kms-key-provider.js');
    sendMock.mockResolvedValueOnce({ Plaintext: Buffer.from('recovered-key') } as never);

    const provider = new KmsKeyProvider('alias/atlas-pii', 'us-east-1');
    const encryptedKey = Buffer.from('wrapped-key-bytes').toString('base64');
    const result = await provider.decryptDataKey(encryptedKey, 'alias/atlas-pii');

    expect(result.toString()).toBe('recovered-key');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentCommand = sendMock.mock.calls[0][0] as { input: { CiphertextBlob: Buffer; KeyId: string } };
    expect(sentCommand.input.CiphertextBlob.toString()).toBe('wrapped-key-bytes');
    expect(sentCommand.input.KeyId).toBe('alias/atlas-pii');
  });

  it('decryptDataKey() throws a clear error when AWS returns no Plaintext', async () => {
    const { KmsKeyProvider } = await import('../../../src/common/utils/crypto/kms-key-provider.js');
    sendMock.mockResolvedValueOnce({} as never);
    const provider = new KmsKeyProvider('alias/atlas-pii', 'us-east-1');
    await expect(provider.decryptDataKey('abc', 'alias/atlas-pii')).rejects.toThrow(/DecryptCommand/);
  });
});
