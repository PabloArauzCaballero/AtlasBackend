/**
 * @file Sobre cifrado para la respuesta que guarda la idempotencia cuando lleva campos sensibles.
 * @business Esta pieza evita duplicados y pérdida de efectos ante reintentos, concurrencia o fallos parciales.
 * @system centraliza idempotencia y outbox como garantías transversales del runtime HTTP.
 */
import { decryptSecretEnvelope, encryptSecretEnvelope } from '../../../common/utils/crypto/envelope-encryption.util.js';
import { redactSensitiveObject } from '../../../common/utils/privacy/redaction.util.js';

/**
 * La respuesta guardada se reproduce tal cual en el reintento. Antes se guardaba REDACTADA, y el
 * replay devolvía `"[REDACTED]"` en lugar del valor (p. ej. `gpsObservationCreated`, un booleano, en
 * POST sessions/start): el cliente recibía otra respuesta que la original, con los tipos rotos.
 *
 * La redacción es para la bitácora, no para una respuesta que se va a repetir. Pero el PII tampoco
 * debe quedar en claro en `idempotency_keys`: si redactar cambiaría el cuerpo, se guarda cifrado
 * con envelope encryption bajo esta clave; si no, se guarda en claro como siempre.
 */
const SEALED_KEY = '__atlasSealedResponse';

export async function sealResponseBody(body: unknown): Promise<Record<string, unknown>> {
  const redacted = redactSensitiveObject(body);
  if (JSON.stringify(redacted) === JSON.stringify(body)) return body as Record<string, unknown>;
  return { [SEALED_KEY]: await encryptSecretEnvelope(JSON.stringify(body)) };
}

/** `undefined` = el sobre no se pudo abrir (clave rotada, KMS ausente): no hay replay fiable. */
export async function openResponseBody(stored: Record<string, unknown>): Promise<unknown> {
  const sealed = stored[SEALED_KEY];
  if (typeof sealed !== 'string') return stored;
  const plain = await decryptSecretEnvelope(sealed);
  return plain === null ? undefined : (JSON.parse(plain) as unknown);
}
