/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza escribe el desenlace real de un envío: llegó, o no llegó y por qué.
 * @system localiza la entrega por el identificador del proveedor y aplica un estado terminal una sola vez.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { NotificationDeliveryModel, NotificationMessageModel } from '../../database/models/index.js';
import { ProviderOutcome } from './adapters/provider-delivery-status.util.js';

/** Estados de los que ya no se sale: una vez escritos, un aviso posterior no los pisa. */
const TERMINAL_DELIVERY_STATUSES = new Set(['delivered', 'failed']);

@Injectable()
export class NotificationDeliveryStatusRepository {
  constructor(
    @InjectModel(NotificationDeliveryModel) private readonly deliveryModel: typeof NotificationDeliveryModel,
    @InjectModel(NotificationMessageModel) private readonly messageModel: typeof NotificationMessageModel,
  ) {}

  /** La entrega que el proveedor identifica con ese id (`sid` de Twilio, `X-Message-Id` de SendGrid). */
  findByProviderMessageId(provider: string, providerMessageId: string): Promise<NotificationDeliveryModel | null> {
    return this.deliveryModel.findOne({
      where: { provider, providerMessageId },
      order: [['attemptNumber', 'DESC']],
    });
  }

  /**
   * La última entrega de un mensaje de ATLAS por ese proveedor.
   *
   * Es el camino de respaldo para SendGrid: el evento trae el id de ATLAS en `custom_args`, que es
   * más fiable que cruzar identificadores del proveedor porque no depende de cómo los decore.
   */
  findLatestByMessageId(provider: string, notificationMessageId: string): Promise<NotificationDeliveryModel | null> {
    return this.deliveryModel.findOne({
      where: { provider, notificationMessageId },
      order: [['attemptNumber', 'DESC']],
    });
  }

  /**
   * Escribe el desenlace, UNA vez.
   *
   * Devuelve `false` si no había nada que escribir, y eso incluye dos casos distintos a propósito:
   * el aviso repetido —los proveedores reintentan su webhook y Twilio manda varios estados por
   * mensaje— y el aviso tardío que contradice un desenlace ya conocido. Los dos se ignoran igual:
   * gana el PRIMER estado terminal. Sin esa regla, un reenvío de un evento viejo podría marcar como
   * rebotado un correo que consta entregado, y nadie podría distinguir cuál de los dos era cierto.
   */
  async applyOutcome(
    delivery: NotificationDeliveryModel,
    outcome: ProviderOutcome,
    errorMessage: string | null,
    at: Date,
  ): Promise<boolean> {
    if (TERMINAL_DELIVERY_STATUSES.has(delivery.status)) return false;

    delivery.status = outcome.status;
    delivery.errorCode = outcome.errorCode;
    delivery.errorMessage = errorMessage;
    if (outcome.status === 'delivered') delivery.deliveredAt = at;
    else delivery.failedAt = at;
    await delivery.save();

    await this.syncMessage(delivery.notificationMessageId, outcome, at);
    return true;
  }

  /**
   * El mensaje sigue a su entrega, salvo que ya lo haya leído alguien.
   *
   * `read` es un estado que sólo puede poner el destinatario y vale más que cualquier cosa que diga
   * el proveedor: si un cliente ya abrió el aviso en la app, un callback que llega tarde no lo
   * devuelve a «entregado».
   */
  private async syncMessage(notificationMessageId: string, outcome: ProviderOutcome, at: Date): Promise<void> {
    const message = await this.messageModel.findByPk(notificationMessageId);
    if (!message || message.status === 'read') return;
    message.status = outcome.status;
    if (outcome.status === 'delivered') message.deliveredAt = at;
    else message.failedAt = at;
    message.updatedAtValue = at;
    await message.save();
  }
}
