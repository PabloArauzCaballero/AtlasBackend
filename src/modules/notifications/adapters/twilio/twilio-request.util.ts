/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system normaliza destinatarios, remitente y errores de Twilio para SMS y WhatsApp por igual.
 */

/** Cómo se identifica el remitente ante Twilio: un número propio o un Messaging Service. */
export type TwilioSender = { From: string } | { MessagingServiceSid: string };

/**
 * Un teléfono en E.164 (`+59170000000`), que es el ÚNICO formato que Twilio acepta en `To`.
 *
 * Los teléfonos de ATLAS entran por donde entra el cliente —alta en la app, carga del ERP, semilla—
 * y llegan como `70000000`, `+591 70000000`, `591-70000000` o `(591) 70000000`. Twilio rechaza los
 * cuatro últimos con `21211` y cobra igual el intento; el primero ni siquiera dice a qué país va.
 * Normalizar aquí, y no en cada sitio que envía, es lo que evita que el mismo número se escriba de
 * cuatro formas y sólo una funcione.
 *
 * La guarda del prefijo es la misma idea que en `common/utils/contact/phone-normalization.util.ts`:
 * un número que YA empieza por el código de país se respeta sólo si al quitarlo queda algo con forma
 * de teléfono. Sin ella, un fijo que empiece por esos dígitos se convertiría en otro número distinto.
 */
export function toE164(value: string | null | undefined, defaultCountryCode: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/gu, '');
  if (digits.length < 7) return null;
  // Ya venía internacional: se respeta tal cual, sin suponerle país.
  if (trimmed.startsWith('+')) return `+${digits}`;
  const country = defaultCountryCode.replace(/\D/gu, '');
  if (!country) return `+${digits}`;
  if (digits.startsWith(country) && digits.length >= country.length + 7) return `+${digits}`;
  return `+${country}${digits}`;
}

/**
 * El remitente, con el Messaging Service por delante del número suelto.
 *
 * Twilio recomienda el Messaging Service porque es lo que da reintento inteligente, pool de números
 * y remitente alfanumérico donde el país lo permite; un `From` fijo no tiene nada de eso. Se acepta
 * igual el número suelto porque es lo que hay en una cuenta de prueba, pero si están los dos gana el
 * servicio: mandar los dos parámetros a la vez es un 400 de Twilio.
 */
export function twilioSender(from: string | undefined, messagingServiceSid: string | undefined): TwilioSender | null {
  const service = messagingServiceSid?.trim();
  if (service) return { MessagingServiceSid: service };
  const number = from?.trim();
  if (number) return { From: number };
  return null;
}

export type TwilioErrorDetails = { code: string | null; message: string | null; permanent: boolean };

/**
 * Códigos de Twilio en los que reintentar NO sirve: el problema es el destinatario, no la red.
 *
 * Reintentar uno de éstos gasta cuota, retrasa el diagnóstico y —en el caso de `21610`— reenvía a
 * alguien que pidió explícitamente no recibir más mensajes. El transporte ya distingue reintentable
 * por status HTTP (`common/resilience/adapter-error.ts`); esto distingue lo que el status no dice,
 * porque Twilio devuelve `400` tanto para «número inválido» como para «tu cuenta no puede escribir a
 * esa región», y sólo el código dice cuál de los dos es.
 */
const PERMANENT_RECIPIENT_ERRORS = new Set([
  '21211', // 'To' no es un número válido
  '21214', // 'To' no es válido para pruebas
  '21408', // la cuenta no tiene permiso para enviar a esa región
  '21606', // el 'From' no puede escribir a ese destino
  '21610', // el destinatario se dio de baja (STOP)
  '21612', // ruta no alcanzable
  '21614', // 'To' no es un número móvil
]);

/**
 * El motivo real de un fallo de Twilio: su `code` y su `message`, vengan donde vengan.
 *
 * El cuerpo del error puede llegar tal cual (`{ code, message }`) o re-expuesto por el transporte
 * bajo `providerResponse` (ver `http-adapter.util.ts`); se miran los dos sitios para que el
 * adaptador no dependa de por qué camino llegó.
 */
export function twilioErrorDetails(response: Record<string, unknown> | null | undefined): TwilioErrorDetails {
  const body = (response?.providerResponse as Record<string, unknown> | undefined) ?? response ?? {};
  const rawCode = body.code;
  const code = typeof rawCode === 'number' || typeof rawCode === 'string' ? String(rawCode) : null;
  const rawMessage = body.message;
  const message = typeof rawMessage === 'string' && rawMessage.trim().length > 0 ? rawMessage.trim() : null;
  return { code, message, permanent: code !== null && PERMANENT_RECIPIENT_ERRORS.has(code) };
}

/** El encabezado `Authorization` de la API REST de Twilio: Basic con SID y token de la cuenta. */
export function twilioAuthHeader(accountSid: string, authToken: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` };
}
