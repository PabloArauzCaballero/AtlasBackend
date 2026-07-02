import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationOrchestratorService } from './notification-orchestrator.service.js';
import {
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
 * NOTA (cierre de ATLAS-AUDIT-027): este archivo mantiene su propia verificación en vez de usar
 * `assertOwnCustomerResource` de `src/common/utils/auth/ownership.util.ts` a propósito: el
 * control de acceso a notificaciones es intencionalmente más estricto que el genérico — solo
 * una lista explícita de roles internos puede leer/gestionar notificaciones de un cliente
 * (notar que `merchant` NO está en esta lista, a diferencia de lo que permitiría el helper
 * genérico, que solo bloquea el rol `customer` y deja pasar cualquier otro rol). Colapsar esto
 * al helper genérico habría sido una regresión de seguridad silenciosa (ampliar el acceso de
 * `merchant` a notificaciones de cualquier cliente). Si la lista de roles permitidos cambia,
 * actualizar únicamente aquí.
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

@Injectable()
export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly orchestrator: NotificationOrchestratorService,
  ) {}

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
}
