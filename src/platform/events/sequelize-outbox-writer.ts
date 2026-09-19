/**
 * @file Escritor de outbox ligado a una transacción (AT-033).
 * @business Escribe la intención de publicar en la misma transacción que el cambio de negocio.
 * @system Se construye por sesión con la transacción de la unidad de trabajo; valida el sobre antes de
 *   insertar (campos prohibidos, ámbito) y devuelve sólo identificadores.
 */
import type { Transaction } from 'sequelize';
import { outboxProducerAttributes } from '../../common/observability/messaging-attributes.js';
import { MessagingTraceService } from '../../common/observability/messaging-trace.service.js';
import { TracingService } from '../../common/observability/tracing.service.js';
import { SPAN_NAMES } from '../../observability/telemetry.constants.js';
import { OutboxEventModel } from '../../database/models/index.js';
import { ApplicationError } from '../contracts/application-error.js';
import { validateEnvelope } from './integration-event.js';
import type { OutboxAppend, OutboxAppended, TransactionalOutbox } from './transactional-outbox.port.js';

export class SequelizeOutboxWriter implements TransactionalOutbox {
  constructor(
    private readonly model: typeof OutboxEventModel,
    private readonly transaction: Transaction,
    private readonly now: () => Date = () => new Date(),
    /**
     * Por defecto y último: este escritor se construye a mano en cada unidad de trabajo y en las
     * pruebas. Sin SDK activo, el servicio abre spans no-op y el portador sale vacío.
     */
    private readonly messaging: MessagingTraceService = new MessagingTraceService(new TracingService()),
  ) {}

  /**
   * `outbox.publish` es un span PRODUCTOR: marca el punto exacto en el que el trabajo deja de ser
   * síncrono. El portador de traza se inyecta DENTRO de este span, así que el span consumidor que
   * abra el relay —minutos después y en otro proceso— cuelga de aquí y la traza queda entera.
   *
   * El portador va en `metadata_json` y NO en el payload del evento: el payload tiene un contrato
   * de dominio validado (`validateEnvelope` rechaza claves prohibidas) y la trazabilidad no puede
   * alterarlo. La columna ya existe, de modo que esto NO necesita migración.
   */
  append(event: OutboxAppend): Promise<OutboxAppended> {
    return this.messaging.runAsProducer(
      SPAN_NAMES.outboxPublish,
      outboxProducerAttributes({
        eventType: event.type,
        aggregateType: event.aggregate.type,
        aggregateId: event.aggregate.id,
        producer: event.producer,
      }),
      () => this.write(event),
    );
  }

  private async write(event: OutboxAppend): Promise<OutboxAppended> {
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
        metadataJson: this.messaging.withCarrier({}),
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
