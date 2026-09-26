/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system arma el cuerpo de `v3/mail/send` y lee de la respuesta el identificador que SendGrid no pone en el JSON.
 */

/** La clave con la que ATLAS marca cada correo para reconocerlo cuando SendGrid cuente qué pasó. */
export const SENDGRID_ATLAS_MESSAGE_ARG = 'atlas_message_id';

export type SendGridMailInput = {
  to: string;
  cc: string[];
  bcc: string[];
  from: string;
  fromName: string | null;
  replyTo: string | null;
  subject: string;
  text: string;
  html: string | null;
  atlasMessageId: string;
};

/**
 * El cuerpo de `POST /v3/mail/send`.
 *
 * Dos detalles que no son adorno:
 *
 * 1. **El orden de `content` es contrato**: SendGrid exige `text/plain` ANTES que `text/html` y
 *    responde 400 si llegan al revés. Mandar sólo HTML deja sin nada al cliente de correo que pide
 *    texto, y mandar sólo texto —lo que hacía este adaptador— convierte en texto plano una plantilla
 *    que se compuso en HTML.
 * 2. **`custom_args` viaja de vuelta en CADA evento** del webhook (entregado, rebote, spam). Es lo
 *    que permite atribuir un rebote a su mensaje de ATLAS sin depender de cruzar identificadores del
 *    proveedor, que además llegan decorados (`sg_message_id` añade un sufijo al `X-Message-Id`).
 */
export function buildSendGridMail(input: SendGridMailInput): Record<string, unknown> {
  const personalization: Record<string, unknown> = { to: [{ email: input.to }] };
  if (input.cc.length > 0) personalization.cc = input.cc.map((email) => ({ email }));
  if (input.bcc.length > 0) personalization.bcc = input.bcc.map((email) => ({ email }));

  const content: Array<{ type: string; value: string }> = [{ type: 'text/plain', value: input.text }];
  if (input.html) content.push({ type: 'text/html', value: input.html });

  return {
    personalizations: [personalization],
    from: input.fromName ? { email: input.from, name: input.fromName } : { email: input.from },
    ...(input.replyTo ? { reply_to: { email: input.replyTo } } : {}),
    subject: input.subject,
    content,
    custom_args: { [SENDGRID_ATLAS_MESSAGE_ARG]: input.atlasMessageId },
  };
}

/**
 * El identificador que asignó SendGrid, que NO viene en el cuerpo.
 *
 * Un envío aceptado responde `202` con cuerpo vacío y el identificador en la cabecera
 * `X-Message-Id`. Mientras el transporte descartaba las cabeceras, el adaptador guardaba el id
 * interno de ATLAS en la columna `provider_message_id`: un dato que parecía correcto, nunca fallaba
 * y no servía para nada, porque ningún evento de SendGrid lo menciona.
 */
export function readSendGridMessageId(headers: Record<string, string>): string | null {
  const value = headers['x-message-id'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * El motivo del rechazo, en una línea.
 *
 * SendGrid contesta `{ errors: [{ message, field, help }] }`; quedarse en «HTTP 400» esconde el
 * único dato accionable, que suele ser «el remitente no está verificado» o «falta un campo».
 */
export function readSendGridErrors(response: Record<string, unknown> | null | undefined): string | null {
  const body = (response?.providerResponse as Record<string, unknown> | undefined) ?? response ?? {};
  const errors = body.errors;
  if (!Array.isArray(errors)) return null;
  const messages = errors
    .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>).message : null))
    .filter((message): message is string => typeof message === 'string' && message.trim().length > 0);
  return messages.length > 0 ? messages.join('; ') : null;
}
