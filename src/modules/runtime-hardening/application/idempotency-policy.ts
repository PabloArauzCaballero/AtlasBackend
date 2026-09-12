/**
 * @file Política de idempotencia: huella semántica, ámbito y replay permitido por operación (AT-010).
 * @business Una clave repetida con un cuerpo distinto en un campo sensible tiene que ser un conflicto,
 *   no un replay; y una respuesta de autenticación no puede quedar guardada para reproducirla.
 * @system Funciones puras sobre la petición. La huella es un HMAC-SHA256 de la representación
 *   canónica SIN redactar: la redacción sirve para los logs, no para decidir igualdad —con ella, dos
 *   cuerpos que sólo difieren en `password` u `otp` colapsaban en el mismo hash. Al ser HMAC con un
 *   secreto del servidor, la huella no permite reconstruir ni verificar el texto original por fuerza
 *   bruta. Versionada (`v2:`) para que las filas antiguas (`v1`, SHA-256 redactado) sigan comparables.
 */
import { createHmac } from 'node:crypto';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { redactSensitiveObject, stableStringify } from '../../../common/utils/privacy/redaction.util.js';

export const FINGERPRINT_VERSION = 'v2';

export type RequestShape = { body: unknown; query: unknown; params: unknown };

/** Huella semántica versionada. `secret` es el del despliegue; rotarlo invalida los replays vigentes. */
export function fingerprintRequest(request: RequestShape, secret: string): string {
  const canonical = stableStringify({ body: request.body, query: request.query, params: request.params });
  return `${FINGERPRINT_VERSION}:${createHmac('sha256', secret).update(canonical).digest('hex')}`;
}

/** Huella de la versión anterior (SHA-256 del cuerpo REDACTADO). Sólo para comparar filas viejas. */
export function legacyFingerprint(request: RequestShape): string {
  return sha256Hex(stableStringify({ body: redactSensitiveObject(request.body), query: request.query, params: request.params }));
}

/**
 * ¿La huella guardada corresponde a esta petición? Las filas escritas antes de `v2` no llevan
 * prefijo: se comparan con el algoritmo con el que se escribieron. Sin esto, cada clave viva en el
 * momento del despliegue se convertiría en un `IDEMPOTENCY_CONFLICT` falso.
 */
export function fingerprintMatches(stored: string, request: RequestShape, secret: string): boolean {
  if (stored.startsWith(`${FINGERPRINT_VERSION}:`)) return stored === fingerprintRequest(request, secret);
  return stored === legacyFingerprint(request);
}

export type OperationClass = 'credentials' | 'mutation';

/**
 * Rutas cuya respuesta contiene credenciales o códigos de un solo uso: no se guarda el cuerpo y no
 * se reproduce. Un reintento de login con la misma clave tiene que volver a autenticar, nunca recibir
 * el token que se le dio a la petición anterior.
 */
const CREDENTIAL_SCOPE = /\/(auth|login|logout|refresh|otp|password|verification-code|verify-code|credentials|token)(\/|\?|$)/i;

export function classifyOperation(scope: string): OperationClass {
  return CREDENTIAL_SCOPE.test(scope) ? 'credentials' : 'mutation';
}

export type OperationPolicy = {
  operation: OperationClass;
  /** Si es falso, el registro se completa con `responseBodyJson: null` y el replay se rechaza. */
  storeResponse: boolean;
};

export function operationPolicy(scope: string): OperationPolicy {
  const operation = classifyOperation(scope);
  return { operation, storeResponse: operation === 'mutation' };
}

/**
 * Un replay sólo vale para el mismo actor. Dos peticiones anónimas (actor `null`) del mismo tenant
 * y clave se consideran el mismo llamador: ahí la clave es todo lo que hay. Cuando alguna de las dos
 * está autenticada, los actores tienen que coincidir; si no, quien llega segundo no recibe la
 * respuesta del primero.
 */
export function sameActor(stored: string | null, current: string | null): boolean {
  if (stored === null && current === null) return true;
  return stored === current;
}
