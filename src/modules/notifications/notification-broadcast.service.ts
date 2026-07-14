import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { mapWithConcurrency } from '../../common/utils/concurrency.util.js';
import { TenantModel } from '../../database/models/index.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { InternalRbacRepository } from '../internal-users/internal-rbac.repository.js';
import { NotificationOrchestratorService } from './notification-orchestrator.service.js';
import { NotificationsRepository } from './notifications.repository.js';
import { CreateBroadcastNotificationDto } from './notifications.schemas.js';
import { RecipientType } from './notification-types.js';

type BroadcastRecipient = { recipientType: RecipientType; recipientId: string };

export type BroadcastResult = {
  broadcastId: string;
  targeted: number;
  created: number;
};

// Cuántos deliverMessage() corren en paralelo por tanda. in_app no hace ninguna llamada externa
// (adapters/in-app-notification.adapter.ts solo marca la fila), así que el costo real es
// puramente de base de datos — se acota igual para no abrir cientos de queries simultáneas
// contra el pool en un broadcast grande.
const DELIVERY_CONCURRENCY = 25;

@Injectable()
export class NotificationBroadcastService {
  private readonly logger = new Logger(NotificationBroadcastService.name);

  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly orchestrator: NotificationOrchestratorService,
    private readonly customersRepository: CustomersRepository,
    private readonly internalRbacRepository: InternalRbacRepository,
    @InjectModel(TenantModel) private readonly tenantModel: typeof TenantModel,
  ) {}

  /**
   * Notificación in-app personalizada disparada por un admin — real de punta a punta: crea una
   * fila `notification_messages` por destinatario y la entrega (marca delivered + registra
   * `notification_deliveries`) vía el mismo `NotificationOrchestratorService` que usan los
   * eventos de dominio. Nada de esto es un mock.
   */
  async broadcast(tenantId: string, input: CreateBroadcastNotificationDto): Promise<BroadcastResult> {
    const recipients = await this.resolveRecipients(tenantId, input);
    return this.dispatch(tenantId, recipients, {
      title: input.title,
      body: input.body,
      priority: input.priority,
      category: input.category,
      icon: input.icon ?? null,
    });
  }

  /**
   * Variante usada por `SystemsHealthMonitorService`: siempre a todo el staff interno activo,
   * sin pasar por el endpoint de admin (no tiene sentido exigir un actor humano para una alerta
   * que dispara el propio backend). `tenantId: null` significa "todos los tenants activos" — una
   * caída de Postgres/Redis es una alerta de infraestructura compartida, no de un tenant
   * específico, así que el caso por defecto (usado por el monitor de salud) es avisarle al staff
   * de TODOS los tenants, no solo a uno.
   */
  async notifyAllInternalUsers(
    tenantId: string | null,
    content: { title: string; body: string; priority: number; category: string; icon?: string | null },
  ): Promise<BroadcastResult[]> {
    const tenantIds = tenantId ? [tenantId] : await this.listActiveTenantIds();
    const results: BroadcastResult[] = [];
    for (const singleTenantId of tenantIds) {
      const internalUserIds = await this.internalRbacRepository.listActiveInternalUserIds(singleTenantId);
      const recipients: BroadcastRecipient[] = internalUserIds.map((internalUserId) => ({
        recipientType: 'internal_user',
        recipientId: internalUserId,
      }));
      results.push(await this.dispatch(singleTenantId, recipients, { ...content, icon: content.icon ?? null }));
    }
    return results;
  }

  private async listActiveTenantIds(): Promise<string[]> {
    const rows = await this.tenantModel.findAll({
      where: { deleted: { [Op.ne]: true }, [Op.or]: [{ status: null }, { status: { [Op.ne]: 'inactive' } }] } as never,
      attributes: ['id'],
    });
    return rows.map((row) => String(row.id));
  }

  private async resolveRecipients(tenantId: string, input: CreateBroadcastNotificationDto): Promise<BroadcastRecipient[]> {
    const recipients: BroadcastRecipient[] = [];

    if (input.audience === 'customers' || input.audience === 'both') {
      const customerIds = input.customerIds ?? (await this.customersRepository.listActiveCustomerIds(tenantId));
      recipients.push(...customerIds.map((customerId) => ({ recipientType: 'customer' as const, recipientId: customerId })));
    }

    if (input.audience === 'internal_users' || input.audience === 'both') {
      const internalUserIds = input.internalUserIds ?? (await this.internalRbacRepository.listActiveInternalUserIds(tenantId));
      recipients.push(
        ...internalUserIds.map((internalUserId) => ({ recipientType: 'internal_user' as const, recipientId: internalUserId })),
      );
    }

    return recipients;
  }

  private async dispatch(
    tenantId: string,
    recipients: BroadcastRecipient[],
    content: { title: string; body: string; priority: number; category: string | null; icon: string | null },
  ): Promise<BroadcastResult> {
    const broadcastId = randomUUID();
    if (recipients.length === 0) {
      this.logger.warn(`Broadcast ${broadcastId} sin destinatarios resueltos — no se crea ningún mensaje.`);
      return { broadcastId, targeted: 0, created: 0 };
    }

    const messages = await this.notificationsRepository.createBroadcastMessages(recipients, {
      tenantId,
      title: content.title,
      body: content.body,
      priority: content.priority,
      category: content.category,
      icon: content.icon,
      correlationId: broadcastId,
    });

    await mapWithConcurrency(messages, DELIVERY_CONCURRENCY, (message) =>
      this.orchestrator.deliverMessage(String(message.id)).catch((error: unknown) => {
        this.logger.warn(
          `Fallo entregando mensaje ${String(message.id)} del broadcast ${broadcastId}: ${error instanceof Error ? error.message : error}`,
        );
      }),
    );

    return { broadcastId, targeted: recipients.length, created: messages.length };
  }
}
