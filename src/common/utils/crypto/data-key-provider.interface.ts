/**
 * ATLAS-AUDIT-012 / ATLAS-PEND-106: interfaz de "proveedor de data key" para envelope
 * encryption. `INFRASTRUCTURE_DEVELOPMENT_CONTEXT.md` §2/§10 fija KMS como parte del stack de
 * cifrado objetivo, pero hoy (`secret-box.util.ts`) el cifrado usa una única clave maestra
 * derivada de una variable de entorno, sin envelope encryption real ni rotación por registro.
 *
 * Este archivo define el contrato que cualquier proveedor de claves debe cumplir, sin importar
 * si la clave la genera KMS o (como hoy, vía `LocalKeyProvider`) una derivación local:
 *
 *  - `generateDataKey()`: genera una data key nueva (una por valor cifrado, no una única clave
 *    maestra reusada para todo), devuelve la clave en claro (para cifrar/descifrar en memoria,
 *    nunca persistida) y la misma clave "envuelta" (cifrada) para guardarla junto al dato.
 *  - `decryptDataKey(encryptedKey, keyId)`: desenvuelve una data key ya guardada para poder
 *    descifrar el valor asociado.
 *
 * Con AWS KMS real, `generateDataKey` llamaría a `GenerateDataKeyCommand` y `decryptDataKey` a
 * `DecryptCommand` — ver `kms-key-provider.ts` para el punto exacto de integración pendiente.
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
