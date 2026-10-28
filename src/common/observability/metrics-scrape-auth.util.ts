/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza evita que el mapa de rutas y las latencias del backend sean legibles por cualquiera que alcance el puerto.
 * @system decide si una petición a `GET /metrics` presenta el token de scrape cuando el despliegue lo exige.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** Longitud mínima del token: un secreto de scrape corto se adivina por fuerza bruta. */
export const METRICS_SCRAPE_TOKEN_MIN_LENGTH = 24;

/**
 * El token que el despliegue exige, o `null` si no exige ninguno (comportamiento histórico: el
 * endpoint se protege sólo por red). Se lee de `process.env` como el resto de la config de
 * observabilidad; una cadena vacía es ausencia, porque el compose entrega vacío cuando falta.
 */
export function readMetricsScrapeToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env['METRICS_SCRAPE_TOKEN']?.trim();
  return raw ? raw : null;
}

/**
 * `true` si no se exige token, o si el `Authorization: Bearer <token>` coincide.
 *
 * Con token configurado pero demasiado corto se RECHAZA todo: es preferible un scrape caído y
 * visible (la alerta `AtlasBackendTargetDown` salta) a un secreto trivial que da falsa sensación de
 * protección. La comparación es de tiempo constante sobre los hashes, para no filtrar la longitud.
 */
export function isMetricsScrapeAuthorized(expected: string | null, authorization: string | undefined): boolean {
  if (expected === null) return true;
  if (expected.length < METRICS_SCRAPE_TOKEN_MIN_LENGTH) return false;
  const [scheme, received] = (authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !received) return false;
  const esperado = createHash('sha256').update(expected).digest();
  const recibido = createHash('sha256').update(received).digest();
  return timingSafeEqual(esperado, recibido);
}
