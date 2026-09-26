/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza impide que un tercero declare entregado —o rebotado— un mensaje que no envió.
 * @system reproduce la firma `X-Twilio-Signature` (HMAC-SHA1 sobre URL + parámetros ordenados).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * La firma que Twilio pone en `X-Twilio-Signature`.
 *
 * Es HMAC-SHA1, con el **token de la cuenta** como clave, sobre la URL COMPLETA a la que llamó
 * —incluido el esquema, el host y la query— concatenada con cada par `clave+valor` del cuerpo
 * ordenado por clave. No es el cuerpo crudo: por eso este endpoint no necesita `rawBody` y el de
 * SendGrid sí.
 *
 * El detalle que rompe la verificación en silencio es la URL: si el backend está detrás de un
 * proxy que termina TLS, `req.protocol` puede decir `http` mientras Twilio firmó `https`, y la
 * comparación falla siempre. Por eso la URL se toma de la configuración —la misma que se le dio a
 * Twilio en `TWILIO_STATUS_CALLBACK_URL`— y no se reconstruye a partir de la petición.
 */
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acumulado, clave) => acumulado + clave + params[clave], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

/** Comparación en tiempo constante: una comparación normal filtra la firma byte a byte. */
export function isValidTwilioSignature(input: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string | undefined;
}): boolean {
  if (!input.signature) return false;
  const esperada = Buffer.from(computeTwilioSignature(input.authToken, input.url, input.params), 'utf8');
  const recibida = Buffer.from(input.signature, 'utf8');
  if (esperada.length !== recibida.length) return false;
  return timingSafeEqual(esperada, recibida);
}
