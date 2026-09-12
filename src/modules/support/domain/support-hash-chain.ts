/**
 * @file Regla de dominio pura: la cadena de hash que hace verificable una transcripción.
 * @business Permite demostrar que la conversación y la historia del caso no fueron alteradas después.
 * @system SHA-256 encadenado por canal y por caso; sin dependencias de base ni de red.
 */
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { stableStringify } from '../../../common/utils/privacy/redaction.util.js';

/** Separador que no puede aparecer dentro de un campo, para que la concatenación no sea ambigua. */
const FIELD_SEPARATOR = '\u001f';

/**
 * Hash del CONTENIDO, calculado sobre el texto original.
 *
 * Se normaliza sólo el final de línea (`\r\n` → `\n`) porque un mismo mensaje enviado desde Android
 * y desde el portal llegaría con saltos distintos y produciría hashes distintos para el mismo texto.
 * No se recorta ni se pasa a minúsculas: aquí importa exactamente lo que se escribió, espacios y
 * mayúsculas incluidos, porque eso es lo que se va a tener que probar.
 */
export function contentHashOf(body: string): string {
  return sha256Hex(body.replace(/\r\n/g, '\n'));
}

/** Hash del contenido de un evento de caso: su tipo más su payload en forma canónica. */
export function eventContentHashOf(eventType: string, payload: unknown): string {
  return sha256Hex(`${eventType}${FIELD_SEPARATOR}${stableStringify(payload)}`);
}

/**
 * El eslabón: identidad del mensaje + contenido + hash del anterior.
 *
 * Incluir `previousHash` es lo que convierte una lista de hashes independientes en una CADENA:
 * sin él, borrar un mensaje del medio no dejaría ninguna huella, porque los demás seguirían
 * validando por su cuenta. Con él, todo lo posterior deja de cuadrar.
 *
 * Se incluye también el emisor y la marca de tiempo del servidor: un atacante con acceso de
 * escritura podría, si no, reutilizar el hash de un mensaje del cliente para uno del agente.
 */
export function messageIntegrityHash(input: {
  channelId: string;
  serverSequence: string | number;
  senderActorType: string;
  senderActorId: string;
  createdAtIso: string;
  contentHash: string;
  previousMessageHash: string | null;
}): string {
  return sha256Hex(
    [
      input.channelId,
      String(input.serverSequence),
      input.senderActorType,
      input.senderActorId,
      input.createdAtIso,
      input.contentHash,
      input.previousMessageHash ?? 'GENESIS',
    ].join(FIELD_SEPARATOR),
  );
}

/** El mismo eslabón para la historia del expediente: mismo razonamiento, otra secuencia. */
export function caseEventHash(input: {
  caseId: string;
  sequenceNumber: string | number;
  eventType: string;
  actorType: string;
  actorId: string | null;
  occurredAtIso: string;
  contentHash: string;
  previousHash: string | null;
}): string {
  return sha256Hex(
    [
      input.caseId,
      String(input.sequenceNumber),
      input.eventType,
      input.actorType,
      input.actorId ?? 'SYSTEM',
      input.occurredAtIso,
      input.contentHash,
      input.previousHash ?? 'GENESIS',
    ].join(FIELD_SEPARATOR),
  );
}

/** Un eslabón tal como se lee de la base, para poder recalcularlo. */
export interface ChainLink {
  readonly integrityHash: string;
  readonly previousHash: string | null;
  readonly recomputed: string;
}

export interface ChainVerification {
  readonly valid: boolean;
  readonly checked: number;
  /** Índices (base 0) donde la cadena dejó de cuadrar. Vacío cuando todo verifica. */
  readonly brokenAt: readonly number[];
}

/**
 * Recorre la cadena y dice dónde se rompió, no sólo que se rompió.
 *
 * Saber el punto exacto es la diferencia entre «alguien tocó la conversación» y «alguien tocó el
 * mensaje 47, el del compromiso de reembolso». Un fallo aquí es un incidente de seguridad, así que
 * la función devuelve el detalle en vez de un booleano que obligue a investigar a ciegas.
 */
export function verifyChain(links: readonly ChainLink[]): ChainVerification {
  const brokenAt: number[] = [];
  let expectedPrevious: string | null = null;

  links.forEach((link, index) => {
    if (link.integrityHash !== link.recomputed) brokenAt.push(index);
    else if (link.previousHash !== expectedPrevious) brokenAt.push(index);
    expectedPrevious = link.integrityHash;
  });

  return { valid: brokenAt.length === 0, checked: links.length, brokenAt };
}
