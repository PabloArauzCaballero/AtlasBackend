/**
 * @file Servicio de aplicación: bandeja in_app del cliente y del personal interno (autoservicio).
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertCustomerAccess, requireInternalUserId } from './notification-access.util.js';
import { NotificationInboxRepository } from './notification-inbox.repository.js';
import { paginate } from './notification-pagination.util.js';
import { CustomerNotificationsQueryDto } from './notifications.schemas.js';
import { mapMessage } from './notifications.mapper.js';

@Injectable()
export class NotificationInboxService {
  constructor(private readonly inbox: NotificationInboxRepository) {}

  async listCustomerNotifications(
    tenantId: string,
    customerId: string,
    query: CustomerNotificationsQueryDto,
    currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, customerId);
    const result = await this.inbox.listRecipientMessages(tenantId, 'customer', customerId, query);
    return paginate(result.rows, result.count, query, mapMessage);
  }

  async unreadCount(tenantId: string, customerId: string, currentUser: AuthenticatedUser) {
    assertCustomerAccess(currentUser, customerId);
    return { unread: await this.inbox.countUnreadMessages(tenantId, 'customer', customerId) };
  }

  async markCustomerNotificationRead(tenantId: string, customerId: string, notificationId: string, currentUser: AuthenticatedUser) {
    assertCustomerAccess(currentUser, customerId);
    const message = await this.inbox.getRecipientMessage(
      tenantId,
      'customer',
      customerId,
      notificationId,
      'CUSTOMER_NOTIFICATION_NOT_FOUND',
    );
    return mapMessage(await this.inbox.markRead(message));
  }

  async markAllCustomerNotificationsRead(tenantId: string, customerId: string, currentUser: AuthenticatedUser) {
    assertCustomerAccess(currentUser, customerId);
    return { updated: await this.inbox.markAllRecipientRead(tenantId, 'customer', customerId) };
  }

  // ---------------------------------------------------------------------------------------
  // Autoservicio de notificaciones para usuarios internos (staff) — mismo patrón que el inbox
  // de customer, pero recipientId siempre es `currentUser.internalUserId` (nunca un parámetro de
  // ruta): un usuario interno solo puede revisar/marcar SUS propias notificaciones. Necesario
  // para que el staff pueda revisar las alertas de servicios caídos y los broadcasts de admin
  // dirigidos a `internal_users`.
  // ---------------------------------------------------------------------------------------

  async listMyNotifications(tenantId: string, query: CustomerNotificationsQueryDto, currentUser: AuthenticatedUser) {
    const internalUserId = requireInternalUserId(currentUser);
    const result = await this.inbox.listRecipientMessages(tenantId, 'internal_user', internalUserId, query);
    return paginate(result.rows, result.count, query, mapMessage);
  }

  async myUnreadCount(tenantId: string, currentUser: AuthenticatedUser) {
    const internalUserId = requireInternalUserId(currentUser);
    return { unread: await this.inbox.countUnreadMessages(tenantId, 'internal_user', internalUserId) };
  }

  async markMyNotificationRead(tenantId: string, notificationId: string, currentUser: AuthenticatedUser) {
    const internalUserId = requireInternalUserId(currentUser);
    const message = await this.inbox.getRecipientMessage(
      tenantId,
      'internal_user',
      internalUserId,
      notificationId,
      'NOTIFICATION_NOT_FOUND',
    );
    return mapMessage(await this.inbox.markRead(message));
  }

  async markAllMyNotificationsRead(tenantId: string, currentUser: AuthenticatedUser) {
    const internalUserId = requireInternalUserId(currentUser);
    return { updated: await this.inbox.markAllRecipientRead(tenantId, 'internal_user', internalUserId) };
  }
}
