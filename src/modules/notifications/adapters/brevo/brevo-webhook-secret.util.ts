/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza impide que un tercero marque como fallido el mensaje de un cliente y lo silencie.
 * @system compara en tiempo constante el secreto que viaja en la URL del callback de Brevo.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * ¿El secreto de la URL es el nuestro?
 *
 * Brevo NO firma sus webhooks: no manda HMAC, ni JWT, ni cabecera de firma. Twilio y SendGrid sí, y
 * por eso allí se verifica una firma; aquí lo único que se puede exigir es conocer una URL que nadie
 * más conoce. Es más débil —quien vea un log de acceso del proxy lo tiene— y por eso el secreto se
 * trata como credencial rotable, no como parte de la ruta.
 *
 * La comparación pasa por SHA-256 antes de `timingSafeEqual` por dos motivos: iguala longitudes (la
 * función lanza si difieren, y esa excepción sería en sí misma una filtración de la longitud del
 * secreto) y evita comparar byte a byte lo recibido con lo esperado.
 */
export function isValidBrevoWebhookSecret(expected: string | null, received: string | undefined): boolean {
  if (!expected || !received) return false;
  const esperado = createHash('sha256').update(expected).digest();
  const recibido = createHash('sha256').update(received).digest();
  return timingSafeEqual(esperado, recibido);
}
