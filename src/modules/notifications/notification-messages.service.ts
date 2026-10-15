/**
 * @file Servicio de aplicación: consulta, reintento y cancelación de mensajes de notificación.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { ConflictException, Injectable } from '@nestjs/common';
import { NotificationDeliveriesRepository } from './notification-deliveries.repository.js';
import { NotificationMessagesRepository } from './notification-messages.repository.js';
import { NotificationOrchestratorService } from './notification-orchestrator.service.js';
import { paginate } from './notification-pagination.util.js';
import { ListMessagesQueryDto } from './notifications.schemas.js';
import { mapDelivery, mapMessage } from './notifications.mapper.js';

@Injectable()
export class NotificationMessagesService {
  constructor(
    private readonly messages: NotificationMessagesRepository,
    private readonly deliveries: NotificationDeliveriesRepository,
    private readonly orchestrator: NotificationOrchestratorService,
  ) {}

  async listMessages(tenantId: string, query: ListMessagesQueryDto) {
    const result = await this.messages.listMessages(tenantId, query);
    return paginate(result.rows, result.count, query, mapMessage);
  }

  async getMessage(tenantId: string, messageId: string) {
    const message = await this.messages.getMessage(tenantId, messageId);
    const deliveries = await this.deliveries.listDeliveries(tenantId, messageId);
    return { ...mapMessage(message), deliveries: deliveries.map(mapDelivery) };
  }

  async retryMessage(tenantId: string, messageId: string) {
    const message = await this.messages.getMessage(tenantId, messageId);
    // Sólo se reintenta lo que falló: antes un SMS entregado o un aviso cancelado salía otra vez.
    if (!(await this.messages.markMessageRetrying(message))) throw new ConflictException('MESSAGE_NOT_RETRYABLE');
    await this.orchestrator.deliverMessage(messageId);
    return this.getMessage(tenantId, messageId);
  }

  async cancelMessage(tenantId: string, messageId: string) {
    return mapMessage(await this.messages.cancelMessage(tenantId, messageId));
  }
}
