/**
 * Contrato para proveedores de data keys de envelope encryption.
 *
 * Cualquier proveedor de claves debe cumplir este contrato, ya sea KMS o `LocalKeyProvider`:
 *
 *  - `generateDataKey()`: genera una data key nueva (una por valor cifrado, no una única clave
 *    maestra reusada para todo), devuelve la clave en claro (para cifrar/descifrar en memoria,
 *    nunca persistida) y la misma clave "envuelta" (cifrada) para guardarla junto al dato.
 *  - `decryptDataKey(encryptedKey, keyId)`: desenvuelve una data key ya guardada para poder
 *    descifrar el valor asociado.
 *
 * Con AWS KMS, `generateDataKey` llama a `GenerateDataKeyCommand` y `decryptDataKey` a
 * `DecryptCommand`.
 */
export type DataEncryptionKey = {
  /** Identificador de qué clave maestra envolvió esta data key (permite rotar sin romper datos viejos). */
  keyId: string;
  /** Clave en claro, SOLO en memoria — nunca se persiste. */
  plaintextKey: Buffer;
  /** Clave envuelta (cifrada), segura de persistir junto al dato cifrado. */
  encryptedKey: string;
};

export interface DataKeyProvider {
  /** Identifica qué proveedor generó/puede desenvolver una data key (`local` | `kms`). Se persiste junto al dato cifrado para saber qué proveedor usar al descifrar. */
  readonly providerId: string;
  generateDataKey(): Promise<DataEncryptionKey>;
  decryptDataKey(encryptedKey: string, keyId: string): Promise<Buffer>;
}
