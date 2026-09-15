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
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { MetricsService } from '../../common/observability/metrics.service.js';
import { ContextOwnershipRegistry } from '../ownership/context-ownership.registry.js';
import { CLAIM_SQL } from './outbox-claim.sql.js';
import { InboxReceiptModel, OutboxEventModel } from '../../database/models/index.js';
import { newOwnerToken } from '../../modules/runtime-hardening/infrastructure/idempotency-claim.store.js';
import { ConsumerRegistry } from './consumer-registry.js';
import { EVENT_CONSUMERS, type EventConsumer } from './event-consumer.port.js';
import { EVENT_PUBLISHER, type EventPublisher, type PublishAck } from './event-publisher.port.js';
import { fromOutboxRow, validateEnvelope, type IntegrationEvent } from './integration-event.js';
import { DEFAULT_RETRY_POLICY, RETRY_POLICY, decideOrder, decideRetry, type RetryPolicy } from './retry-policy.js';

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
      const event = fromOutboxRow(row);
      const validation = validateEnvelope(event);
      // Publicación FUERA de la transacción de reclamo; el cierre es condicional al testigo.
      const ack: PublishAck = validation.ok
        ? await this.publisher.publish(event)
        : { accepted: false, transport: 'validation', permanent: true, reason: `EVENT_${validation.code}` };
      const outcome = await this.settle(row, ownerToken, ack, now);
      if (!outcome) continue;
      result[outcome] += 1;
      this.metrics?.recordOutboxRelay({ outcome: RELAY_METRIC_OUTCOME[outcome], transport: ack.transport });
    }
    return result;
  }
}
