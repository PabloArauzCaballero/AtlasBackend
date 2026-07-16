# ADR-0004: Envelope encryption con proveedor de claves intercambiable (local/KMS)

- **Estado:** Aceptado
- **Fecha:** 2026-07-16
- **Decisores:** equipo backend
- **Relacionado:** [`envelope-encryption.util.ts`](../../src/common/utils/crypto/envelope-encryption.util.ts), [`kms-key-provider.ts`](../../src/common/utils/crypto/kms-key-provider.ts), [`local-key-provider.ts`](../../src/common/utils/crypto/local-key-provider.ts), [`src/main.ts`](../../src/main.ts), [`scripts/reencrypt-pii-to-envelope.ts`](../../scripts/reencrypt-pii-to-envelope.ts), plan 10/10 Fase 3.3

## Contexto

Los datos sensibles (PII de clientes, tokens de dispositivos para notificaciones) se
cifran en reposo con **envelope encryption**: cada valor usa su propia _data key_
(AES-256-GCM), y la data key se envuelve con una _master key_ provista por un
`DataKeyProvider` intercambiable. El formato de salida es
`v2:<providerId>:<keyId>:<encryptedDataKey>:<iv>:<tag>:<ciphertext>`, con soporte de
lectura del formato legado `v1:`.

Hay dos proveedores:

- **`LocalKeyProvider`** — master key derivada de configuración local. Simple, sin
  dependencias externas, apto para desarrollo/test.
- **`KmsKeyProvider`** — usa un KMS gestionado (AWS KMS) vía `KMS_KEY_ID` + `AWS_REGION`.

## Decisión

1. El sistema usa **envelope encryption con proveedor intercambiable**. Hay un **proveedor
   de cifrado activo** que los call sites toman por defecto (`encryptSecretEnvelope(x)` sin
   argumento). Arranca en **`local`**.
2. En `main.ts`, si `KMS_KEY_ID` **y** `AWS_REGION` están presentes, se llama a
   `setActiveEncryptionProvider(new KmsKeyProvider(...))`: el proveedor activo pasa a
   **`kms`** y **todas las escrituras nuevas de PII se cifran con KMS real** sin tocar
   ningún call site (Fase 3.3 **cerrada**).
3. El **descifrado no depende del proveedor activo**: cada valor lleva su `providerId`
   embebido (`v2:<providerId>:...`), así que valores previos cifrados con `local` se
   siguen descifrando aunque el activo sea `kms`, y viceversa. Ambos proveedores quedan
   registrados para descifrado.
4. Existe un script idempotente de re-cifrado (`yarn crypto:reencrypt-pii`, con
   `--dry-run`) para migrar valores existentes entre proveedores/claves.
5. Sin KMS configurado, el proveedor activo permanece en `local` — default seguro para
   dev/test.

### Requisitos de producción para el corte a KMS

- `@aws-sdk/client-kms` debe estar instalado en la imagen final (el proveedor lo importa
  de forma dinámica; sin él, con KMS configurado, las escrituras de PII fallarán).
- Ejecutar el [runbook de rotación de claves](../runbooks/rotacion-de-claves.md) en
  staging antes del corte en producción.

### Optimización de costo pendiente (no bloqueante)

Hoy se genera **una data key de KMS por valor cifrado** (máxima seguridad: clave única
por dato). A escala esto implica una llamada `GenerateDataKey` por campo. Si el
costo/latencia lo justifica, se puede introducir **reutilización acotada de data keys**
dentro de un límite de seguridad. Es una optimización con su propio trade-off de
seguridad; se difiere hasta tener la métrica de costo que la justifique.

## Alternativas consideradas

- **Cifrado con una sola clave estática (sin envelope)** — imposible rotar sin
  re-cifrar todo con downtime, y una fuga de la clave compromete todo el corpus.
  Descartada.
- **KMS obligatorio en todos los entornos** — rompe desarrollo/test offline y CI sin
  credenciales cloud. Descartada; por eso el proveedor es intercambiable y opcional.
- **Una llamada KMS por campo** — correcto en seguridad pero caro y lento a escala.
  Se prefiere reutilización acotada de data keys cuando se active KMS.

## Consecuencias

- **Positivas:** el algoritmo de cifrado es agnóstico del proveedor; migrar de `local`
  a `kms` es un cambio de configuración + re-cifrado, sin cambiar el formato; el default
  seguro (no configurar KMS) es válido para dev/test.
- **Negativas / costos asumidos:** con KMS activo, cada escritura de PII depende de que
  KMS esté disponible y correctamente permisado, y de `@aws-sdk/client-kms` instalado;
  una data key por valor implica una llamada KMS por campo hasta implementar la
  reutilización acotada.
- **Condición de revisión (trigger):** revisar si se implementa reutilización de data
  keys (cuando la métrica de costo/latencia de KMS lo justifique) o si se cambia el
  proveedor/HSM.
