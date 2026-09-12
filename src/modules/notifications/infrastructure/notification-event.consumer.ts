/**
 * @file Consumidor de eventos de Mensajería (AT-035): el orquestador de notificaciones como suscriptor.
 * @business Mensajería recibe los hechos de dominio catalogados y decide qué avisar; el relay no la conoce.
 * @system Implementa `EventConsumer` con identidad estable y suscripción a los tipos del catálogo (v1). Carga
 *   Se suscribe a todos los tipos de dominio (`*`): el orquestador ya decide por sus reglas qué evento
 *   produce aviso y cuál no, así que Mensajería no necesita conocer el catálogo de Eventos. Carga
 *   la fila del outbox por `event_id` para reutilizar `handleEvent` tal cual (que hoy lee el modelo); el
 *   recibo del inbox lo escribe el relay en la misma transacción que este `handle`.
 */
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { OutboxEventModel } from '../../../database/models/index.js';
import type { EventConsumer } from '../../../platform/events/event-consumer.port.js';
import type { IntegrationEvent } from '../../../platform/events/integration-event.js';
import { NotificationOrchestratorService } from '../notification-orchestrator.service.js';

@Injectable()
export class NotificationEventConsumer implements EventConsumer {
  readonly consumerId = 'notifications.orchestrator';
  readonly subscriptions: Readonly<Record<string, readonly number[]>> = Object.freeze({ '*': [1] });

  constructor(private readonly orchestrator: NotificationOrchestratorService) {}

  async handle(event: IntegrationEvent, _transaction: Transaction): Promise<void> {
    void _transaction;
    const row = await OutboxEventModel.findOne({ where: { eventId: event.eventId } as never });
    if (!row)
      throw Object.assign(new Error(`OUTBOX_ROW_NOT_FOUND:${event.eventId}`), { code: 'CONSUMER_REJECTED_PERMANENTLY', permanent: true });
    await this.orchestrator.handleEvent(row);
  }
}
