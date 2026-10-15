/**
 * @file Construye el payload que reciben los adaptadores de canal a partir de un mensaje persistido.
 * @business Reúne los destinos reales del destinatario (dispositivos, contactos, destinos cifrados) para cada envío.
 * @system lee dispositivos push y contactos del cliente y descifra los destinos guardados en el mensaje.
 */
import { Injectable } from '@nestjs/common';
import { NotificationMessageModel } from '../../database/models/index.js';
import { NotificationDeviceTokensRepository } from './notification-device-tokens.repository.js';
import { decryptDeliveryTargets } from './notification-delivery-targets.util.js';
import { NotificationChannel, NotificationMessagePayload } from './notification-types.js';

/** Resuelve el id de un mensaje de forma robusta: `.id` directo o `getDataValue('id')` como fallback. */
export function resolveMessageId(message: NotificationMessageModel): string {
  if (message.id !== undefined && message.id !== null) return String(message.id);
  const viaDataValue = (message as { getDataValue?: (key: string) => unknown }).getDataValue?.('id');
  return String(viaDataValue);
}

@Injectable()
export class NotificationDeliveryPayloadBuilder {
  constructor(private readonly recipientTargets: NotificationDeviceTokensRepository) {}

  async build(message: NotificationMessageModel, channel: NotificationChannel): Promise<NotificationMessagePayload> {
    // Resolución defensiva del id: algunos modelos Sequelize no exponen `.id` directamente y hay que
    // leerlo con getDataValue('id'). Se conserva esta robustez ahora que el modelo se pasa directo.
    const tenantId = message.tenantId === null ? null : String(message.tenantId);
    const pushDevices =
      channel === 'push' && message.recipientType === 'customer'
        ? await this.recipientTargets.getActivePushDevices(tenantId, message.recipientId)
        : [];
    const customerContactTargets =
      message.recipientType === 'customer'
        ? await this.recipientTargets.getCustomerContactTargets(tenantId, message.recipientId, channel)
        : [];
    const storedTargets = await decryptDeliveryTargets(message.deliveryTargetsJson);
    return {
      id: resolveMessageId(message),
      tenantId,
      recipientType: message.recipientType,
      recipientId: message.recipientId,
      channel,
      subject: message.subject,
      title: message.title,
      body: message.body,
      payload: (message.payloadJson ?? {}) as Record<string, unknown>,
      correlationId: message.correlationId,
      deliveryTargets: [
        ...storedTargets,
        ...customerContactTargets,
        // La plataforma viaja en `metadata`: es lo que decide si el aviso sale por APNs o por FCM.
        ...pushDevices.map((device) => ({ kind: 'fcm_token' as const, address: device.token, metadata: { platform: device.platform } })),
      ],
    };
  }
}
