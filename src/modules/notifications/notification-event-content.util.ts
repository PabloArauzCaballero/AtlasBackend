/**
 * @file Utilidades puras del contenido de un aviso nacido de un evento de dominio.
 * @business Decide a quién se avisa y con qué texto de respaldo, sin dejar que el payload elija el destino.
 * @system funciones sin estado: resolución de destinatario, texto de respaldo y filtrado del payload.
 */
import { OutboxEventModel } from '../../database/models/index.js';
import { NotificationChannel, RecipientType } from './notification-types.js';

export function getPayloadValue(payload: Record<string, unknown>, path: string[] | undefined): string | null {
  if (!path || path.length === 0) return null;
  let current: unknown = payload;
  for (const part of path) {
    if (typeof current !== 'object' || current === null || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === 'number') return String(current);
  if (typeof current === 'string' && current.trim().length > 0) return current;
  return null;
}

export function defaultRecipientId(event: OutboxEventModel, recipientType: RecipientType, payload: Record<string, unknown>): string | null {
  if (recipientType === 'operations') return getPayloadValue(payload, ['assignedTeamId']) ?? 'operations';
  if (recipientType === 'customer' && event.aggregateType === 'customer' && event.aggregateId) return event.aggregateId;
  if (recipientType === 'merchant' && event.aggregateType === 'merchant' && event.aggregateId) return event.aggregateId;
  return null;
}

/**
 * Claves del payload que los adaptadores leen como CONTENIDO o DESTINO del envío (`email-payload.util`,
 * `getFirstDeliveryTarget`). En un aviso nacido de un evento de dominio no pintan nada: el texto sale de
 * la plantilla del servidor y el destino, de los contactos del cliente. Si viajaran, quien controlara el
 * payload del evento elegiría el HTML del correo, sus copias ocultas y a qué dirección o teléfono sale.
 */
const DELIVERY_OVERRIDE_KEYS: ReadonlySet<string> = new Set(
  [
    ...['html', 'htmlBody', 'cc', 'bcc', 'replyTo', 'reply_to'],
    ...['email', 'toEmail', 'recipientEmail', 'phone', 'toPhone', 'recipientPhone', 'smsTo', 'whatsappTo', 'whatsapp'],
    ...['fcmToken', 'pushToken', 'deviceToken'],
  ].map((key) => key.toLowerCase()),
);

export function withoutDeliveryOverrides(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !DELIVERY_OVERRIDE_KEYS.has(key.toLowerCase())));
}

export function fallbackText(eventCode: string, channel: NotificationChannel): { title: string; subject: string | null; body: string } {
  const readable = eventCode.replaceAll('.', ' ');
  return {
    title: `ATLAS: ${readable}`,
    subject: channel === 'email' ? `ATLAS: ${readable}` : null,
    body: `Se registró el evento ${eventCode}.`,
  };
}
