import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationBroadcastService, BroadcastResult } from './notification-broadcast.service.js';
import { NotificationOrchestratorService } from './notification-orchestrator.service.js';
import {
  CreateBroadcastNotificationDto,
  CreateTemplateDto,
  CustomerNotificationsQueryDto,
  ListMessagesQueryDto,
  ListTemplatesQueryDto,
  UpdatePreferencesDto,
  UpdateTemplateDto,
  UpsertDeviceTokenDto,
} from './notifications.schemas.js';
import { mapDelivery, mapDeviceToken, mapMessage, mapPreference, mapTemplate } from './notifications.mapper.js';

/**
 * Las notificaciones usan una autorización más estricta que el helper genérico de ownership:
 * solo el cliente dueño o una lista explícita de roles internos puede leer/gestionar mensajes.
 */
function canAccessCustomer(currentUser: AuthenticatedUser, customerId: string): boolean {
  if (currentUser.role === 'customer') return currentUser.customerId === customerId;
  return ['internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system'].includes(
    currentUser.role,
  );
}

function assertCustomerAccess(currentUser: AuthenticatedUser, customerId: string): void {
  if (!canAccessCustomer(currentUser, customerId)) throw new ForbiddenException('CUSTOMER_NOTIFICATION_ACCESS_DENIED');
}

function requireInternalUserId(currentUser: AuthenticatedUser): string {
  if (!currentUser.internalUserId) throw new ForbiddenException('INTERNAL_USER_TOKEN_REQUIRED');
  return currentUser.internalUserId;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly orchestrator: NotificationOrchestratorService,
    private readonly broadcastService: NotificationBroadcastService,
  ) {}

  async broadcast(tenantId: string, body: CreateBroadcastNotificationDto): Promise<BroadcastResult> {
    return this.broadcastService.broadcast(tenantId, body);
  }

  async listMessages(tenantId: string, query: ListMessagesQueryDto) {
    const result = await this.repository.listMessages(tenantId, query);
    return {
      data: result.rows.map(mapMessage),
      pagination: { page: query.page, limit: query.limit, total: result.count, totalPages: Math.ceil(result.count / query.limit) },
    };
  }

  async getMessage(tenantId: string, messageId: string) {
    const message = await this.repository.getMessage(tenantId, messageId);
    const deliveries = await this.repository.listDeliveries(tenantId, messageId);
    return { ...mapMessage(message), deliveries: deliveries.map(mapDelivery) };
  }

  async retryMessage(tenantId: string, messageId: string) {
    const message = await this.repository.getMessage(tenantId, messageId);
    message.status = 'retrying';
    message.failedAt = null;
    message.updatedAtValue = new Date();
    await message.save();
    await this.orchestrator.deliverMessage(messageId);
    return this.getMessage(tenantId, messageId);
  }

  async cancelMessage(tenantId: string, messageId: string) {
    return mapMessage(await this.repository.cancelMessage(tenantId, messageId));
  }

  async listTemplates(tenantId: string, query: ListTemplatesQueryDto) {
    const result = await this.repository.listTemplates(tenantId, query);
    return {
      data: result.rows.map(mapTemplate),
      pagination: { page: query.page, limit: query.limit, total: result.count, totalPages: Math.ceil(result.count / query.limit) },
    };
  }

  async createTemplate(tenantId: string, body: CreateTemplateDto) {
    return mapTemplate(await this.repository.createTemplate(tenantId, body));
  }

  async updateTemplate(tenantId: string, templateId: string, body: UpdateTemplateDto) {
    return mapTemplate(await this.repository.updateTemplate(tenantId, templateId, body));
  }

  async getPreferences(tenantId: string, customerId: string) {
    return { data: (await this.repository.getPreferences(tenantId, customerId)).map(mapPreference) };
  }

  async updatePreferences(tenantId: string, customerId: string, body: UpdatePreferencesDto) {
    return { data: (await this.repository.upsertPreferences(tenantId, customerId, body)).map(mapPreference) };
  }

  async listCustomerNotifications(
    tenantId: string,
    customerId: string,
    query: CustomerNotificationsQueryDto,
    currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, customerId);
    const result = await this.repository.listCustomerMessages(tenantId, customerId, query);
    return {
      data: result.rows.map(mapMessage),
      pagination: { page: query.page, limit: query.limit, total: result.count, totalPages: Math.ceil(result.count / query.limit) },
    };
  }

  async unreadCount(tenantId: string, customerId: string, currentUser: AuthenticatedUser) {
    assertCustomerAccess(currentUser, customerId);
    return { unread: await this.repository.countUnreadCustomerMessages(tenantId, customerId) };
  }

  async markCustomerNotificationRead(tenantId: string, customerId: string, notificationId: string, currentUser: AuthenticatedUser) {
    assertCustomerAccess(currentUser, customerId);
    const message = await this.repository.getCustomerMessage(tenantId, customerId, notificationId);
    return mapMessage(await this.repository.markRead(message));
  }

  async markAllCustomerNotificationsRead(tenantId: string, customerId: string, currentUser: AuthenticatedUser) {
    assertCustomerAccess(currentUser, customerId);
    return { updated: await this.repository.markAllCustomerRead(tenantId, customerId) };
  }

  async upsertDeviceToken(tenantId: string, customerId: string, body: UpsertDeviceTokenDto, currentUser: AuthenticatedUser) {
    assertCustomerAccess(currentUser, customerId);
    return mapDeviceToken(await this.repository.upsertDeviceToken(tenantId, customerId, body));
  }

  async deactivateDeviceToken(tenantId: string, customerId: string, deviceTokenId: string, currentUser: AuthenticatedUser) {
    assertCustomerAccess(currentUser, customerId);
    return mapDeviceToken(await this.repository.deactivateDeviceToken(tenantId, customerId, deviceTokenId));
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
    const result = await this.repository.listRecipientMessages(tenantId, 'internal_user', internalUserId, query);
    return {
      data: result.rows.map(mapMessage),
      pagination: { page: query.page, limit: query.limit, total: result.count, totalPages: Math.ceil(result.count / query.limit) },
    };
  }

  async myUnreadCount(tenantId: string, currentUser: AuthenticatedUser) {
    const internalUserId = requireInternalUserId(currentUser);
    return { unread: await this.repository.countUnreadMessages(tenantId, 'internal_user', internalUserId) };
  }

  async markMyNotificationRead(tenantId: string, notificationId: string, currentUser: AuthenticatedUser) {
    const internalUserId = requireInternalUserId(currentUser);
    const message = await this.repository.getRecipientMessage(
      tenantId,
      'internal_user',
      internalUserId,
      notificationId,
      'NOTIFICATION_NOT_FOUND',
    );
    return mapMessage(await this.repository.markRead(message));
  }

  async markAllMyNotificationsRead(tenantId: string, currentUser: AuthenticatedUser) {
    const internalUserId = requireInternalUserId(currentUser);
    return { updated: await this.repository.markAllRecipientRead(tenantId, 'internal_user', internalUserId) };
  }
}
