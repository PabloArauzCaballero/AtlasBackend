/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza distingue «lo aceptó el proveedor» de «llegó a su destinatario».
 * @system traduce los estados de Twilio y SendGrid al vocabulario propio de `notification_deliveries`.
 */
import { DeliveryStatus } from '../notification-types.js';

/** Un desenlace que el proveedor confirma DESPUÉS del envío, con su motivo si fue malo. */
export type ProviderOutcome = { status: Extract<DeliveryStatus, 'delivered' | 'failed'>; errorCode: string | null };

/**
 * Qué significa cada `MessageStatus` de Twilio.
 *
 * Twilio contesta al envío con `queued`/`accepted` —que sólo dice que el mensaje entró en su cola— y
 * avisa del desenlace real por callback minutos después. Los estados intermedios (`sending`, `sent`)
 * devuelven `null` a propósito: no son noticia, y escribirlos pisaría un desenlace ya conocido.
 *
 * `undelivered` y `failed` son distintos para Twilio (el primero es «el operador lo rechazó», el
 * segundo «no salió de Twilio») y lo mismo para ATLAS: los dos significan que ese mensaje NO llegó.
 */
export function twilioOutcome(status: string | undefined, errorCode?: string | null): ProviderOutcome | null {
  const normalizado = status?.trim().toLowerCase();
  if (normalizado === 'delivered' || normalizado === 'read') return { status: 'delivered', errorCode: null };
  if (normalizado === 'undelivered' || normalizado === 'failed' || normalizado === 'canceled')
    return { status: 'failed', errorCode: errorCode ? `TWILIO_${errorCode}` : `TWILIO_${normalizado.toUpperCase()}` };
  return null;
}

/**
 * Qué significa cada evento del webhook de SendGrid.
 *
 * `processed` y `deferred` no se traducen: el primero repite lo que ya sabíamos al enviar y el
 * segundo es un reintento en curso —tratarlo como fallo daría por perdido un correo que aún puede
 * llegar—. `open` y `click` hablan de la conducta del destinatario, no de la entrega.
 *
 * `spamreport` y `unsubscribe` tampoco son fallos de entrega: ESE correo sí llegó. Son motivos para
 * dejar de escribirle a esa dirección, que es una decisión de otra pieza (la lista de supresión),
 * no un desenlace de esta entrega.
 */
export function sendGridOutcome(event: string | undefined): ProviderOutcome | null {
  const normalizado = event?.trim().toLowerCase();
  if (normalizado === 'delivered') return { status: 'delivered', errorCode: null };
  if (normalizado === 'bounce' || normalizado === 'dropped' || normalizado === 'blocked')
    return { status: 'failed', errorCode: `SENDGRID_${normalizado.toUpperCase()}` };
  return null;
}

/**
 * El `X-Message-Id` que ATLAS guardó, a partir del `sg_message_id` del evento.
 *
 * SendGrid decora el identificador en los eventos: lo que al enviar fue `abc123` vuelve como
 * `abc123.filterdrecv-...`. Comparar los dos tal cual no cruza NUNCA.
 */
export function sendGridBaseMessageId(sgMessageId: unknown): string | null {
  if (typeof sgMessageId !== 'string' || sgMessageId.trim().length === 0) return null;
  return sgMessageId.trim().split('.')[0] ?? null;
}

/**
 * Qué significa cada `msg_status` del webhook de SMS de Brevo.
 *
 * Brevo no manda un campo `event`: el desenlace viaja en `msg_status`, y sus valores no son los de
 * nadie más (`bl` es «lista negra», `rej` es «rechazado», y el guion bajo de `hard_bounce` no está
 * en la versión de correo). Confundirlos no da error: da un estado que nunca se escribe.
 *
 * `soft_bounce` devuelve `null` a propósito, por la misma razón que `deferred` en SendGrid: es un
 * «ahora no» del operador —teléfono apagado, fuera de cobertura— y el mensaje todavía puede llegar.
 * Marcarlo como fallo daría por perdido un SMS que aún está en camino, y como gana el PRIMER estado
 * terminal, el `delivered` posterior ya no podría corregirlo.
 *
 * `unsubscribed` tampoco es un fallo de entrega: ESE mensaje llegó. Es un motivo para dejar de
 * escribir a ese número, que es una decisión de otra pieza, no el desenlace de esta entrega.
 */
export function brevoSmsOutcome(msgStatus: string | undefined, errorCode?: string | null): ProviderOutcome | null {
  const normalizado = msgStatus?.trim().toLowerCase();
  if (normalizado === 'delivered') return { status: 'delivered', errorCode: null };
  if (normalizado === 'hard_bounce' || normalizado === 'bl' || normalizado === 'rej' || normalizado === 'skip')
    return { status: 'failed', errorCode: errorCode ? `BREVO_${errorCode}` : `BREVO_${normalizado.toUpperCase()}` };
  return null;
}
