/**
 * @file Relay durable del outbox (AT-034, AT-035, AT-036): reclama con lease y testigo, publica fuera de
 *   la transacción de reclamo, despacha a consumidores con inbox y cierra condicionalmente.
 * @business Dos relays reparten filas sin perder eventos ni permitir que un lease viejo cierre trabajo
 *   recuperado por otro; un consumidor que ya procesó un evento no lo repite; un fallo permanente va a
 *   la DLQ (`status='failed'`) sin bucle.
 * @system Reclamo: `UPDATE … WHERE status='pending' … FOR UPDATE SKIP LOCKED` con `owner_token` nuevo.
 *   Despacho local: por consumidor, una transacción con `INSERT inbox_receipts` + `handle(event, tx)`;
 *   la unicidad (consumer_id, event_id) convierte la reentrega en no-op. Cierre: `UPDATE … WHERE
 *   owner_token = :token AND status='processing'` (fencing). No importa el orquestador de notificaciones:
 *   ese es un consumidor más, registrado en composición.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { outboxConsumerAttributes } from '../../common/observability/messaging-attributes.js';
import { MessagingTraceService } from '../../common/observability/messaging-trace.service.js';
import { recordSpanError } from '../../common/observability/trace-error.js';
import { TracingService } from '../../common/observability/tracing.service.js';
import { APP_ATTRIBUTES, SPAN_NAMES } from '../../observability/telemetry.constants.js';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { MetricsService } from '../../common/observability/metrics.service.js';
import { ContextOwnershipRegistry } from '../ownership/context-ownership.registry.js';
import { CLAIM_SQL } from './outbox-claim.sql.js';
import { OutboxEventModel } from '../../database/models/index.js';
import { newOwnerToken } from '../../modules/runtime-hardening/infrastructure/idempotency-claim.store.js';
import { ConsumerRegistry } from './consumer-registry.js';
import { EVENT_CONSUMERS, type EventConsumer } from './event-consumer.port.js';
import { EVENT_PUBLISHER, type EventPublisher, type PublishAck } from './event-publisher.port.js';
import { LocalConsumerDispatchPublisher } from './local-consumer-dispatch.publisher.js';
import { fromOutboxRow, validateEnvelope } from './integration-event.js';

/** Se re-exporta para no romper a quien ya lo importaba desde aquí. */
export { LocalConsumerDispatchPublisher };
import { DEFAULT_RETRY_POLICY, RETRY_POLICY, decideRetry, type RetryPolicy } from './retry-policy.js';

export type RelayRunResult = Readonly<{
  /** AT-059: `true` cuando el relay no era el dueño del contexto y no reclamó nada. */
  fenced: boolean;
  claimed: number;
  published: number;
  retried: number;
  deadLettered: number;
  quarantined: number;
  eventIds: string[];
}>;

export const OUTBOX_LEASE_MS = 5 * 60_000;

type RelayCounter = 'published' | 'retried' | 'deadLettered' | 'quarantined';
const RELAY_METRIC_OUTCOME: Record<RelayCounter, 'published' | 'retried' | 'dead_lettered' | 'quarantined'> = {
  published: 'published',
  retried: 'retried',
  deadLettered: 'dead_lettered',
  quarantined: 'quarantined',
};

@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly publisher: EventPublisher;

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @Optional() @Inject(EVENT_CONSUMERS) consumers: EventConsumer[] = [],
    @Optional() @Inject(EVENT_PUBLISHER) publisher?: EventPublisher,
    // Sin token, Nest intentaría resolver el parámetro y el arranque fallaría: `docs:openapi` lo cazó.
    @Optional() @Inject(RETRY_POLICY) private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly ownership?: ContextOwnershipRegistry,
    @Optional() private readonly messaging: MessagingTraceService = new MessagingTraceService(new TracingService()),
  ) {
    this.publisher = publisher ?? new LocalConsumerDispatchPublisher(sequelize, new ConsumerRegistry(consumers));
  }

  /** Reclama hasta `limit` eventos pendientes con un testigo nuevo. Transacción corta: sólo el claim. */
  async claim(input: {
    tenantId: string | null;
    limit: number;
    workerId: string;
    now?: Date;
    /** AT-059: propiedad y época que este relay cree tener; el claim sólo procede si siguen vigentes. */
    ownership?: { context: string; owner: string; epoch: number };
  }): Promise<{ ownerToken: string; rows: OutboxEventModel[] }> {
    const ownerToken = newOwnerToken();
    const now = input.now ?? new Date();
    const claimed = await this.sequelize.transaction((transaction) =>
      this.sequelize.query<{ id: string }>(CLAIM_SQL, {
        replacements: {
          now,
          tenantId: input.tenantId,
          limit: input.limit,
          workerId: input.workerId,
          ownerToken,
          ownershipContext: input.ownership?.context ?? null,
          ownershipOwner: input.ownership?.owner ?? null,
          ownershipEpoch: input.ownership?.epoch ?? null,
        },
        type: QueryTypes.SELECT,
        transaction,
      }),
    );
    if (claimed.length === 0) return { ownerToken, rows: [] };
    const rows = await OutboxEventModel.findAll({ where: { id: claimed.map((row) => row.id) } as never, order: [['id', 'ASC']] });
    return { ownerToken, rows };
  }

  /** Cierre con fencing: sólo el dueño del testigo cambia el estado. Devuelve si esta corrida lo consiguió. */
  async complete(row: OutboxEventModel, ownerToken: string, values: Record<string, unknown>): Promise<boolean> {
    const [affected] = await OutboxEventModel.update(
      { ...values, lockedAt: null, lockedBy: null, updatedAtValue: new Date() },
      { where: { id: row.id, ownerToken, status: 'processing' } as never },
    );
    if (affected !== 1) this.logger.warn(`OUTBOX_LEASE_LOST ${row.eventId}: otro relay recuperó el evento; este resultado no se escribe.`);
    return affected === 1;
  }

  /** Cierra el evento según el acuse; devuelve el contador a incrementar o `null` si otro relay ganó la fila. */
  private async settle(row: OutboxEventModel, ownerToken: string, ack: PublishAck, now: Date): Promise<RelayCounter | null> {
    if (ack.accepted) {
      return (await this.complete(row, ownerToken, { status: 'processed', processedAt: now })) ? 'published' : null;
    }
    const decision = decideRetry({
      attempts: row.attempts ?? 1,
      now,
      error: { code: ack.reason, permanent: ack.permanent },
      policy: this.policy,
    });
    if (decision.action === 'dead_letter') {
      const closed = await this.complete(row, ownerToken, {
        status: 'failed',
        failedAt: now,
        errorCode: ack.permanent ? 'EVENT_QUARANTINED' : 'EVENT_MAX_ATTEMPTS',
        lastError: ack.reason,
      });
      if (!closed) return null;
      return ack.permanent ? 'quarantined' : 'deadLettered';
    }
    const retried = await this.complete(row, ownerToken, {
      status: 'pending',
      availableAt: decision.availableAt,
      errorCode: 'EVENT_PROCESSING_FAILED',
      lastError: ack.reason,
    });
    return retried ? 'retried' : null;
  }

  async run(input: {
    tenantId: string | null;
    limit: number;
    workerId: string;
    now?: Date;
    /** AT-059: quién cree ser este relay; si el registro nombra a otro dueño, no reclama nada. */
    ownership?: { context: string; owner: string };
  }): Promise<RelayRunResult> {
    const now = input.now ?? new Date();
    let ownership: { context: string; owner: string; epoch: number } | undefined;
    if (input.ownership && this.ownership) {
      const current = await this.ownership.current(input.ownership.context);
      if (current && current.owner !== input.ownership.owner) {
        this.logger.warn(
          `OWNERSHIP_FENCED ${input.ownership.context}: dueño ${current.owner} (época ${current.epoch}); este relay (${input.ownership.owner}) no reclama.`,
        );
        return { fenced: true, claimed: 0, published: 0, retried: 0, deadLettered: 0, quarantined: 0, eventIds: [] };
      }
      // La época viaja al claim: si la propiedad cambia entre esta lectura y el UPDATE, se reclaman 0 filas.
      if (current) ownership = { context: current.context, owner: current.owner, epoch: current.epoch };
    }
    const { ownerToken, rows } = await this.claim({ ...input, now, ownership });
    const result = {
      fenced: false,
      claimed: rows.length,
      published: 0,
      retried: 0,
      deadLettered: 0,
      quarantined: 0,
      eventIds: rows.map((row) => String(row.id)),
    };
    for (const row of rows) {
      const done = await this.dispatchRow(row, ownerToken, now);
      if (!done) continue;
      result[done.counter] += 1;
      this.metrics?.recordOutboxRelay({ outcome: RELAY_METRIC_OUTCOME[done.counter], transport: done.transport });
    }
    return result;
  }

  /**
   * Despacha UNA fila dentro de un span CONSUMIDOR enlazado con quien la publicó.
   *
   * Es el único punto del backend donde la traza cruza de un proceso a otro: el contexto vive en
   * `AsyncLocalStorage` y muere en el commit de la API, así que aquí se RECONSTRUYE desde el
   * portador que viajó en `metadata_json`. Una fila escrita antes de que esto existiera no lleva
   * portador y abre una traza propia: se procesa igual, que es lo que importa.
   */
  private async dispatchRow(
    row: OutboxEventModel,
    ownerToken: string,
    now: Date,
  ): Promise<{ counter: RelayCounter; transport: string } | null> {
    const event = fromOutboxRow(row);
    const attributes = outboxConsumerAttributes({
      eventType: event.type,
      aggregateType: event.aggregate.type,
      aggregateId: event.aggregate.id,
      attempt: row.attempts ?? 0,
    });
    return this.messaging.runAsConsumer(SPAN_NAMES.outboxDispatch, row.metadataJson, attributes, async (span) => {
      const validation = validateEnvelope(event);
      // Publicación FUERA de la transacción de reclamo; el cierre es condicional al testigo.
      const ack: PublishAck = validation.ok
        ? await this.publisher.publish(event)
        : { accepted: false, transport: 'validation', permanent: true, reason: `EVENT_${validation.code}` };
      const counter = await this.settle(row, ownerToken, ack, now);
      span.setAttribute(APP_ATTRIBUTES.jobOutcome, counter ?? 'lease_lost');
      // Un reintento no es un fallo del despacho; la DLQ sí, y tiene que poder buscarse en Jaeger
      // como error sin depender de que alguien lea la tabla.
      if (!ack.accepted && (counter === 'deadLettered' || counter === 'quarantined')) {
        recordSpanError(span, new Error(ack.reason), { code: ack.reason, retryable: false });
      }
      return counter === null ? null : { counter, transport: ack.transport };
    });
  }
}
