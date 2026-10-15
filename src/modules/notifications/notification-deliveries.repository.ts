/**
 * @file Puerto de persistencia: intentos de entrega por mensaje (registro y consulta).
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { redactSensitiveObject } from '../../common/utils/privacy/redaction.util.js';
import { NotificationDeliveryModel, NotificationMessageModel } from '../../database/models/index.js';
import { DeliveryResult, NotificationMessagePayload } from './notification-types.js';

@Injectable()
export class NotificationDeliveriesRepository {
  constructor(@InjectModel(NotificationDeliveryModel) private readonly deliveryModel: typeof NotificationDeliveryModel) {}

  async recordDelivery(
    message: NotificationMessageModel,
    payload: NotificationMessagePayload,
    result: DeliveryResult,
  ): Promise<NotificationDeliveryModel> {
    const now = new Date();
    const attemptNumber = (await this.deliveryModel.count({ where: { notificationMessageId: message.id } })) + 1;
    const delivery = await this.deliveryModel.create({
      tenantId: message.tenantId,
      notificationMessageId: message.id,
      channel: message.channel,
      provider: result.provider,
      providerMessageId: result.providerMessageId ?? null,
      status: result.status,
      attemptNumber,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
      requestPayloadJson: redactSensitiveObject(payload) as Record<string, unknown>,
      responsePayloadJson: redactSensitiveObject(result.response ?? {}) as Record<string, unknown>,
      sentAt: result.status === 'sent' || result.status === 'delivered' ? now : null,
      deliveredAt: result.status === 'delivered' ? now : null,
      failedAt: result.status === 'failed' ? now : null,
      createdAtValue: now,
    });

    if (result.status === 'failed') {
      message.status = 'failed';
      message.failedAt = now;
    } else if (result.status === 'delivered') {
      message.status = 'delivered';
      message.sentAt = now;
      message.deliveredAt = now;
    } else if (result.status === 'sent') {
      message.status = 'sent';
      message.sentAt = now;
    }
    message.updatedAtValue = now;
    await message.save();
    return delivery;
  }

  async listDeliveries(tenantId: string, messageId: string): Promise<NotificationDeliveryModel[]> {
    return this.deliveryModel.findAll({ where: { tenantId, notificationMessageId: messageId }, order: [['attemptNumber', 'ASC']] });
  }
}
