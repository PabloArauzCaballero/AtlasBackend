/**
 * @file Adaptador local del puerto de solicitud de notificación (AT-017).
 * @business Hoy el aviso se registra en la misma base y lo entrega el flujo actual; el consumidor no
 *   tiene que saberlo, y cuando Mensajería se extraiga este adaptador se sustituye por uno remoto.
 * @system Valida contrato (tenant, canal, destinatario), traduce a `NotificationsRepository.createMessage`
 *   —que ya deduplica por `idempotencyKey`— y devuelve sólo valores. No expone el modelo.
 */
import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../../../platform/contracts/application-error.js';
import type { NotificationRequestPort } from '../application/ports/notification-request.port.js';
import { NotificationsRepository } from '../notifications.repository.js';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_RECIPIENT_TYPES,
  type NotificationRequestContext,
  type NotificationRequestInput,
  type NotificationRequestResult,
} from '../public/notification.contracts.js';

@Injectable()
export class LocalNotificationRequestAdapter implements NotificationRequestPort {
  constructor(private readonly repository: NotificationsRepository) {}

  async request(input: NotificationRequestInput, context: NotificationRequestContext): Promise<NotificationRequestResult> {
    if (!context.tenantId) throw new ApplicationError({ kind: 'forbidden', code: 'NOTIFICATION_TENANT_REQUIRED' });
    if (!NOTIFICATION_CHANNELS.includes(input.channel)) {
      throw new ApplicationError({ kind: 'invalid', code: 'NOTIFICATION_CHANNEL_NOT_ALLOWED', publicDetail: input.channel });
    }
    if (!NOTIFICATION_RECIPIENT_TYPES.includes(input.recipient.type) || !input.recipient.id) {
      throw new ApplicationError({ kind: 'invalid', code: 'NOTIFICATION_RECIPIENT_INVALID' });
    }
    if (!input.body && !input.templateCode) throw new ApplicationError({ kind: 'invalid', code: 'NOTIFICATION_BODY_REQUIRED' });

    const dedupKey = input.dedupKey ?? null;
    const existing = dedupKey ? await this.repository.findByIdempotencyKey(context.tenantId, dedupKey) : null;
    const message =
      existing ??
      (await this.repository.createMessage({
        tenantId: context.tenantId,
        outboxEventId: null,
        recipientType: input.recipient.type,
        recipientId: input.recipient.id,
        channel: input.channel,
        templateCode: input.templateCode,
        subject: input.title,
        title: input.title,
        body: input.body,
        payload: { ...input.payload },
        priority: input.priority ?? 5,
        category: input.category ?? null,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        idempotencyKey: dedupKey,
        correlationId: context.correlationId,
        causationId: context.causationId ?? null,
      }));
    return Object.freeze({ notificationId: String(message.id), accepted: true, status: message.status, deduplicated: existing !== null });
  }
}
