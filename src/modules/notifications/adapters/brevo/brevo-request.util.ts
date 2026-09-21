/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system normaliza destinatarios, cabecera y errores de Brevo para SMS y WhatsApp por igual.
 */
import { toE164 } from '../twilio/twilio-request.util.js';

export const BREVO_API_BASE = 'https://api.brevo.com/v3';

/** Brevo no usa `Authorization`: la clave va en su propia cabecera `api-key`. */
export function brevoAuthHeader(apiKey: string): Record<string, string> {
  return { 'api-key': apiKey };
}

/**
 * Un teléfono como lo quiere Brevo: dígitos con código de país y SIN `+`.
 *
 * Se apoya en `toE164` —el mismo normalizador que usa Twilio— en vez de tener su propia limpieza:
 * los teléfonos de ATLAS entran como `70000000`, `+591 70000000` o `(591) 70000000` según por dónde
 * entró el cliente, y tener dos normalizadores distintos es tener dos criterios sobre qué país
 * suponerle a un número sin prefijo. Lo único propio de Brevo es que el `+` sobra.
 */
export function toBrevoNumber(value: string | null | undefined, defaultCountryCode: string): string | null {
  const e164 = toE164(value, defaultCountryCode);
  return e164 ? e164.replace(/^\+/u, '') : null;
}

export type BrevoErrorDetails = { code: string | null; message: string | null; permanent: boolean };

/**
 * Códigos de Brevo en los que reintentar NO sirve porque el problema no es la red.
 *
 * Es la misma distinción que se hace con Twilio y por el mismo motivo: el transporte ya reintenta
 * según el status HTTP, pero Brevo devuelve `400` tanto para «ese número no existe» como para
 * «faltó un parámetro», y `402` tanto para «te quedaste sin crédito» como para «tu cuenta sigue en
 * validación». Sin mirar el `code`, los cuatro quedan registrados como «HTTP 400» y nadie puede
 * distinguir un número mal escrito de una cuenta que hay que recargar.
 */
const PERMANENT_ERRORS = new Set([
  'invalid_parameter', // el número, el remitente o la plantilla no son válidos
  'missing_parameter',
  'out_of_range',
  'unauthorized', // la clave no vale: reintentar la gasta igual
  'permission_denied',
  'not_enough_credits', // sin crédito no hay reintento que ayude
  'account_under_validation',
  'document_not_found', // la plantilla de WhatsApp no existe
]);

/**
 * El motivo real de un fallo de Brevo: su `code` y su `message`, vengan donde vengan.
 *
 * El cuerpo puede llegar tal cual o re-expuesto por el transporte bajo `providerResponse` (ver
 * `http-adapter.util.ts`); se miran los dos sitios para que el adaptador no dependa del camino.
 */
export function brevoErrorDetails(response: Record<string, unknown> | null | undefined): BrevoErrorDetails {
  const body = (response?.providerResponse as Record<string, unknown> | undefined) ?? response ?? {};
  const rawCode = body.code;
  const code = typeof rawCode === 'string' && rawCode.trim().length > 0 ? rawCode.trim() : null;
  const rawMessage = body.message;
  const message = typeof rawMessage === 'string' && rawMessage.trim().length > 0 ? rawMessage.trim() : null;
  return { code, message, permanent: code !== null && PERMANENT_ERRORS.has(code) };
}

/**
 * El identificador que devolvió Brevo, como texto.
 *
 * Llega como NÚMERO en SMS (`{"messageId": 1511882900100020}`) y como cadena en WhatsApp. Guardarlo
 * con el tipo que vino haría que el callback —que lo manda como número— no cruzara nunca con lo
 * guardado en `notification_deliveries`, que es una columna de texto.
 */
export function brevoMessageId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}
