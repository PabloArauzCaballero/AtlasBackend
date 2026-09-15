/**
 * @file Escritor de outbox ligado a una transacción (AT-033).
 * @business Escribe la intención de publicar en la misma transacción que el cambio de negocio.
 * @system Se construye por sesión con la transacción de la unidad de trabajo; valida el sobre antes de
 *   insertar (campos prohibidos, ámbito) y devuelve sólo identificadores.
 */
import type { Transaction } from 'sequelize';
import { OutboxEventModel } from '../../database/models/index.js';
import { ApplicationError } from '../contracts/application-error.js';
import { validateEnvelope } from './integration-event.js';
import type { OutboxAppend, OutboxAppended, TransactionalOutbox } from './transactional-outbox.port.js';

export class SequelizeOutboxWriter implements TransactionalOutbox {
  constructor(
    private readonly model: typeof OutboxEventModel,
    private readonly transaction: Transaction,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async append(event: OutboxAppend): Promise<OutboxAppended> {
    const now = this.now();
    const tenantId = event.scope.kind === 'tenant' ? event.scope.tenantId : null;
    const check = validateEnvelope({
      eventId: 'pending',
      type: event.type,
      category: 'domain',
      schemaVersion: event.schemaVersion ?? 1,
      producer: event.producer,
      scope: event.scope,
      aggregate: { type: event.aggregate.type, id: event.aggregate.id, version: event.aggregate.version ?? null },
      occurredAt: now.toISOString(),
      correlationId: event.correlationId ?? null,
      causationId: event.causationId ?? null,
      payload: event.payload,
    });
    if (!check.ok) throw new ApplicationError({ kind: 'invalid', code: `EVENT_${check.code}`, publicDetail: check.detail });

    const row = await this.model.create(
      {
        tenantId,
        aggregateType: event.aggregate.type,
        aggregateId: event.aggregate.id,
        aggregateVersion: event.aggregate.version ?? null,
        eventCode: event.type,
        eventPayloadJson: { ...event.payload },
        eventFamily: 'domain',
        eventVersion: event.schemaVersion ?? 1,
        schemaVersion: event.schemaVersion ?? 1,
        producer: event.producer,
        metadataJson: {},
        status: 'pending',
        priority: event.priority ?? 0,
        attempts: 0,
        maxAttempts: 3,
        availableAt: now,
        idempotencyKey: event.dedupKey ?? null,
        correlationId: event.correlationId ?? null,
        causationId: event.causationId ?? null,
        sourceModule: event.producer,
        createdAtValue: now,
        updatedAtValue: now,
      } as never,
      { transaction: this.transaction },
    );
    return Object.freeze({ eventId: row.eventId, outboxRowId: String(row.id) });
  }
}
