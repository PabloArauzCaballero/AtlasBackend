/**
 * @file Publicador local: el «transporte» del monolito, despacho durable a consumidores en proceso.
 * @business Un consumidor que ya procesó un evento no lo repite; un fallo permanente va a la DLQ.
 * @system Por consumidor, una transacción con `INSERT inbox_receipts` + `handle(event, tx)`; la
 *   unicidad (consumer_id, event_id) convierte la reentrega en no-op. Sale de `outbox-relay.service.ts`
 *   —donde convivía con el relay— porque son dos responsabilidades y el gate de tamaño lo señaló.
 */
import { Logger } from '@nestjs/common';
import { QueryTypes, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { InboxReceiptModel } from '../../database/models/index.js';
import { ConsumerRegistry } from './consumer-registry.js';
import type { EventConsumer } from './event-consumer.port.js';
import type { EventPublisher, PublishAck } from './event-publisher.port.js';
import type { IntegrationEvent } from './integration-event.js';
import { decideOrder } from './retry-policy.js';

/**
 * Despacho local durable: el «transporte» del monolito. Para cada consumidor suscrito abre una
 * transacción, escribe el recibo e invoca `handle`. El recibo y el efecto se confirman juntos.
 */
export class LocalConsumerDispatchPublisher implements EventPublisher {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly registry: ConsumerRegistry,
    private readonly logger: Logger = new Logger(LocalConsumerDispatchPublisher.name),
  ) {}

  async publish(event: IntegrationEvent): Promise<PublishAck> {
    const { ready, incompatible } = this.registry.consumersFor(event.type, event.schemaVersion);
    if (incompatible.length > 0) {
      return {
        accepted: false,
        transport: 'local',
        permanent: true,
        reason: `INCOMPATIBLE_SCHEMA_FOR:${incompatible.map((c) => c.consumerId).join(',')}`,
      };
    }
    for (const consumer of ready) {
      const outcome = await this.deliverTo(consumer, event);
      if (!outcome.ok)
        return { accepted: false, transport: 'local', permanent: outcome.permanent, reason: `${consumer.consumerId}:${outcome.reason}` };
    }
    return { accepted: true, transport: 'local' };
  }

  private async deliverTo(
    consumer: EventConsumer,
    event: IntegrationEvent,
  ): Promise<{ ok: true } | { ok: false; permanent: boolean; reason: string }> {
    const now = new Date();
    try {
      await this.sequelize.transaction(async (transaction) => {
        // Orden por agregado: última versión aplicada por ESTE consumidor para ESTE agregado.
        const lastApplied = await this.lastAppliedVersion(consumer.consumerId, event, transaction);
        const order = decideOrder({ lastApplied, incoming: event.aggregate.version });
        if (order.action === 'wait')
          throw Object.assign(new Error(`ORDER_GAP:${order.missing.join(',')}`), { code: 'ORDER_GAP', permanent: false });
        await InboxReceiptModel.create(
          {
            consumerId: consumer.consumerId,
            eventId: event.eventId,
            producer: event.producer,
            status: order.action === 'stale' ? 'stale' : 'processed',
            attempts: 1,
            lastError: null,
            processedAt: now,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
        if (order.action === 'stale') return;
        await consumer.handle(event, transaction);
      });
      return { ok: true };
    } catch (error) {
      // Reentrega de un evento ya recibido: el recibo existe, el efecto ya se confirmó con él. No-op.
      if (error instanceof UniqueConstraintError) return { ok: true };
      const typed = error as { code?: string; permanent?: boolean; message?: string };
      this.logger.warn(`Consumidor ${consumer.consumerId} falló con ${event.type} ${event.eventId}: ${typed.message ?? String(error)}`);
      return {
        ok: false,
        permanent: typed.permanent === true,
        reason: typed.code === 'ORDER_GAP' ? (typed.message ?? 'ORDER_GAP') : (typed.code ?? typed.message ?? 'CONSUMER_ERROR'),
      };
    }
  }

  private async lastAppliedVersion(
    consumerId: string,
    event: IntegrationEvent,
    transaction: import('sequelize').Transaction,
  ): Promise<number | null> {
    if (event.aggregate.version === null || !event.aggregate.id) return null;
    const rows = await this.sequelize.query<{ v: string | null }>(
      `SELECT max(o.aggregate_version)::text AS v FROM platform_ops.inbox_receipts r
       JOIN platform_ops.outbox_events o ON o.event_id = r.event_id
       WHERE r.consumer_id = $consumerId AND r.status = 'processed' AND o.aggregate_type = $type AND o.aggregate_id = $id`,
      { type: QueryTypes.SELECT, bind: { consumerId, type: event.aggregate.type, id: event.aggregate.id }, transaction },
    );
    return rows[0]?.v === null || rows[0]?.v === undefined ? null : Number(rows[0].v);
  }
}
