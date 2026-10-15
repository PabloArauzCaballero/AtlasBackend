/**
 * @file Puerto de persistencia: bandeja in_app por destinatario (listado, conteo de no leídos y marcado como leído).
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { NotificationMessageModel } from '../../database/models/index.js';
import { CustomerNotificationsQueryDto } from './notifications.schemas.js';
import { RecipientType } from './notification-types.js';
import { notExpired } from './campaigns/notification-visibility.util.js';
import { HIDDEN_INBOX_STATUSES, withCreatedBetween, withInboxStatus, withTextSearch } from './notification-list.filters.js';

/**
 * El mismo inbox in-app sirve a `customer` y a `internal_user` (endpoints de autoservicio
 * `internal-users/me/notifications*`): todo se parametriza por tipo e id de destinatario.
 */
@Injectable()
export class NotificationInboxRepository {
  constructor(@InjectModel(NotificationMessageModel) private readonly messageModel: typeof NotificationMessageModel) {}

  async getRecipientMessage(
    tenantId: string,
    recipientType: RecipientType,
    recipientId: string,
    messageId: string,
    notFoundCode = 'NOTIFICATION_NOT_FOUND',
  ): Promise<NotificationMessageModel> {
    const message = await this.messageModel.findOne({
      where: { tenantId, recipientType, recipientId, id: messageId },
    });
    if (!message) throw new NotFoundException(notFoundCode);
    return message;
  }

  async listRecipientMessages(tenantId: string, recipientType: RecipientType, recipientId: string, query: CustomerNotificationsQueryDto) {
    const where: Record<string | symbol, unknown> = { tenantId, recipientType, recipientId, channel: 'in_app', ...notExpired() };
    withInboxStatus(where, query.status);
    if (query.channel) where.channel = query.channel;
    withCreatedBetween(where, query);
    withTextSearch(where, query.q, ['title', 'subject', 'body']);
    return this.messageModel.findAndCountAll({
      where: where as never,
      order: [
        ['createdAtValue', 'DESC'],
        ['id', 'DESC'],
      ],
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    });
  }

  async countUnreadMessages(tenantId: string, recipientType: RecipientType, recipientId: string): Promise<number> {
    return this.messageModel.count({
      where: {
        tenantId,
        recipientType,
        recipientId,
        channel: 'in_app',
        readAt: null,
        status: { [Op.notIn]: HIDDEN_INBOX_STATUSES },
        ...notExpired(),
      } as never,
    });
  }

  async markRead(message: NotificationMessageModel): Promise<NotificationMessageModel> {
    const now = new Date();
    message.status = 'read';
    message.readAt = now;
    message.updatedAtValue = now;
    await message.save();
    return message;
  }

  async markAllRecipientRead(tenantId: string, recipientType: RecipientType, recipientId: string): Promise<number> {
    const [count] = await this.messageModel.update(
      { status: 'read', readAt: new Date(), updatedAtValue: new Date() },
      {
        where: {
          tenantId,
          recipientType,
          recipientId,
          channel: 'in_app',
          readAt: null,
          status: { [Op.notIn]: HIDDEN_INBOX_STATUSES },
        } as never,
      },
    );
    return count;
  }
}
