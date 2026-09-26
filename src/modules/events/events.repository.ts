/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza desacopla procesos de negocio y permite reintentos auditables sin perder eventos.
 * @system registra definiciones, outbox y procesamiento idempotente de eventos de dominio.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { redactSensitiveObject } from '../../common/utils/privacy/redaction.util.js';
import { OutboxEventModel } from '../../database/models/index.js';
import { getEventDefinition, listEventDefinitions } from './event-registry.js';
import { CLAIM_PENDING_EVENTS_SQL, EVENT_LOCK_EXPIRED_MESSAGE, RECLAIM_STUCK_EVENTS_SQL } from './outbox-queries.constants.js';
import { ListEventsQueryDto } from './events.schemas.js';
import { PublishEventInput } from './event-types.js';
import { destinationsFor, enqueueOutboundDeliveries } from '../../platform/events/outbound-subscriptions.js';

function registeredEventCodes(): string[] {
  return listEventDefinitions().map((event) => event.code);
}

/** La fila del outbox para un evento publicado; los valores por defecto salen del registro de eventos. */
function outboxRowValues(input: PublishEventInput, now: Date): Record<string, unknown> {
  const definition = getEventDefinition(input.eventCode);
  return {
    ...envelopeValues(input),
    eventPayloadJson: redactSensitiveObject(input.payload ?? {}) as Record<string, unknown>,
    eventFamily: definition?.family ?? 'uncatalogued',
    eventVersion: definition?.version ?? 1,
    metadataJson: redactSensitiveObject(input.metadata ?? {}) as Record<string, unknown>,
    status: 'pending',
    priority: input.priority ?? definition?.defaultPriority ?? 0,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    lockedAt: null,
    lockedBy: null,
    availableAt: input.availableAt ?? now,
    processedAt: null,
    failedAt: null,
    errorCode: null,
    lastError: null,
    createdAtValue: now,
    updatedAtValue: now,
  };
}

/** Identidad y trazabilidad del evento: agregado (con su versión), idempotencia, correlación y origen. */
function envelopeValues(input: PublishEventInput): Record<string, unknown> {
  const version = input.aggregateVersion;
  return {
    tenantId: input.tenantId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId ?? null,
    aggregateVersion: version === undefined || version === null ? null : String(version),
    eventCode: input.eventCode,
    idempotencyKey: input.idempotencyKey ?? null,
    correlationId: input.correlationId ?? null,
    causationId: input.causationId ?? null,
    sourceModule: input.sourceModule ?? null,
    sourceAction: input.sourceAction ?? null,
  };
}

@Injectable()
export class EventsRepository {
  constructor(
    @InjectModel(OutboxEventModel) private readonly outboxModel: typeof OutboxEventModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Escribe el evento en el outbox. Con `transaction`, DENTRO de la transacción de quien llama.
   *
   * Hasta P-08 (2026-09-24) `EventsService.publish` no la pasaba nunca: un caso de uso que
   * «publicaba dentro de su transacción» en realidad escribía el evento por otra conexión, en
   * autocommit. Si la transacción del negocio se revertía después, el evento quedaba confirmado y
   * describía un hecho que no existió — un aviso de pago sin reclamo, una confirmación sin cobro.
   *
   * La inserción va en un SAVEPOINT cuando hay transacción externa: en PostgreSQL una violación de
   * la unicidad por idempotencia aborta la transacción entera, y el rescate de abajo (leer la fila
   * que ganó) no podría ni ejecutarse. Con el savepoint sólo se deshace la inserción fallida.
   */
  async createEvent(input: PublishEventInput, options: { transaction?: Transaction } = {}): Promise<OutboxEventModel> {
    const now = new Date();
    const transaction = options.transaction;
    const findExisting = () =>
      this.outboxModel.findOne({
        where: { tenantId: input.tenantId, eventCode: input.eventCode, idempotencyKey: input.idempotencyKey },
        transaction,
      });

    if (input.idempotencyKey) {
      const existing = await findExisting();
      if (existing) return existing;
    }

    const values = outboxRowValues(input, now);

    // P-14: el evento y su entrega a cada servicio suscrito (hoy el ERP para `payment.*`) nacen juntos.
    const persist = async (tx?: Transaction): Promise<OutboxEventModel> => {
      const row = await this.outboxModel.create(values as never, { transaction: tx });
      await enqueueOutboundDeliveries(this.sequelize, row, tx);
      return row;
    };

    try {
      if (!transaction) {
        return destinationsFor(input.eventCode).length > 0 ? await this.sequelize.transaction((tx) => persist(tx)) : await persist();
      }
      return await this.sequelize.transaction({ transaction }, (savepoint) => persist(savepoint));
    } catch (error) {
      if (!input.idempotencyKey) throw error;
      const existing = await findExisting();
      if (existing) return existing;
      throw error;
    }
  }

  async list(tenantId: string, query: ListEventsQueryDto): Promise<{ rows: OutboxEventModel[]; count: number }> {
    const where: WhereOptions = { tenantId } as never;
    if (query.status) (where as Record<string, unknown>).status = query.status;
    if (query.eventCode) (where as Record<string, unknown>).eventCode = query.eventCode;
    if (query.aggregateType) (where as Record<string, unknown>).aggregateType = query.aggregateType;
    if (query.correlationId) (where as Record<string, unknown>).correlationId = query.correlationId;
    return this.outboxModel.findAndCountAll({
      where,
      order: [
        ['createdAtValue', 'DESC'],
        ['id', 'DESC'],
      ],
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    });
  }

  /**
   * Variante por cursor de `list()`. Referencia de aplicación del patrón
   * documentado en `src/common/utils/pagination/cursor-pagination.util.ts`. A diferencia de
   * `list()` (que sigue usando `OFFSET`, mantenido por compatibilidad), esta consulta no paga
   * un costo creciente por página profunda: siempre filtra por la clave del cursor en vez de
   * saltar N filas.
   */
  async listWithCursor(
    tenantId: string,
    query: ListEventsQueryDto,
    cursorKey: { createdAt: string; id: string } | null,
  ): Promise<OutboxEventModel[]> {
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.eventCode) where.eventCode = query.eventCode;
    if (query.aggregateType) where.aggregateType = query.aggregateType;
    if (query.correlationId) where.correlationId = query.correlationId;

    if (cursorKey) {
      // Comparación de tupla: equivalente a "más viejo que la última fila de la página
      // anterior", sin importar cuántas filas haya antes — el índice compuesto
      // (created_at DESC, id DESC) hace este filtro directo, no un escaneo.
      where[Op.and as unknown as string] = [
        {
          [Op.or]: [
            { createdAtValue: { [Op.lt]: new Date(cursorKey.createdAt) } },
            {
              [Op.and]: [{ createdAtValue: new Date(cursorKey.createdAt) }, { id: { [Op.lt]: cursorKey.id } }],
            },
          ],
        },
      ];
    }

    // Se pide limit + 1 para saber si existe una página siguiente sin una segunda consulta
    // (ver `paginateWithCursor`, que hace el recorte final).
    return this.outboxModel.findAll({
      where: where as never,
      order: [
        ['createdAtValue', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: query.limit + 1,
    });
  }

  async getById(tenantId: string, eventId: string): Promise<OutboxEventModel> {
    const event = await this.outboxModel.findOne({ where: { tenantId, id: eventId } });
    if (!event) throw new NotFoundException('EVENT_NOT_FOUND');
    return event;
  }

  async listPending(input: { tenantId?: string | null; limit: number }): Promise<OutboxEventModel[]> {
    const eventCodes = registeredEventCodes();
    if (eventCodes.length === 0) return [];
    const where: Record<string, unknown> = {
      status: 'pending',
      eventCode: { [Op.in]: eventCodes },
      availableAt: { [Op.lte]: new Date() },
    };
    if (input.tenantId) where.tenantId = input.tenantId;
    return this.outboxModel.findAll({
      where: where as never,
      order: [
        ['priority', 'DESC'],
        ['availableAt', 'ASC'],
        ['id', 'ASC'],
      ],
      limit: input.limit,
    });
  }

  /**
   * Devuelve a la cola los eventos VARADOS en `processing`.
   *
   * `claimPending` marca el evento como `processing` y le pone `locked_by` en una transacción propia;
   * la resolución (`processed` / `pending` con backoff / `failed`) ocurre después, en otra escritura.
   * Si el proceso muere entre ambas —despliegue, OOM, `SIGKILL`, pérdida de la conexión— el evento se
   * queda en `processing` para siempre: TODAS las consultas de reclamo filtran por `status='pending'`,
   * así que nadie vuelve a mirarlo. Es pérdida silenciosa de un evento ya contabilizado como intento.
   *
   * El criterio de "varado" es temporal (`locked_at` más viejo que el corte), no de proceso: no se
   * puede saber si el `locked_by` que lo tomó sigue vivo, y preguntarlo requeriría un registro de
   * workers que sería otra cosa más que puede quedar desincronizada. Un corte holgado frente a la
   * duración normal de una entrega es suficiente y no puede duplicar trabajo en curso.
   *
   * El destino depende del presupuesto de intentos, que `claimPending` YA consumió al reclamar:
   * si quedan intentos vuelve a `pending` y disponible ahora; si no, cae a `failed`, que es el
   * estado de dead-letter del que `retryEvent` lo saca a mano. Nunca se pierde: cambia de cola.
   *
   * `FOR UPDATE SKIP LOCKED` mantiene la misma garantía que el reclamo normal: dos reapers
   * simultáneos se reparten filas en vez de pelearse por ellas.
   */
  async reclaimStuckProcessing(input: { tenantId?: string | null; olderThan: Date; limit: number }): Promise<{
    requeued: number;
    deadLettered: number;
    eventIds: string[];
  }> {
    const now = new Date();
    const rows = await this.sequelize.transaction(async (transaction) =>
      this.sequelize.query<{ id: string; status: string }>(RECLAIM_STUCK_EVENTS_SQL, {
        replacements: {
          tenantId: input.tenantId ?? null,
          olderThan: input.olderThan,
          limit: input.limit,
          now,
          lastError: EVENT_LOCK_EXPIRED_MESSAGE,
        },
        type: QueryTypes.SELECT,
        transaction,
      }),
    );

    return {
      requeued: rows.filter((row) => row.status === 'pending').length,
      deadLettered: rows.filter((row) => row.status === 'failed').length,
      eventIds: rows.map((row) => String(row.id)),
    };
  }

  /** Cuántos eventos hay varados en `processing` por encima del corte (para dry-run y métricas). */
  countStuckProcessing(input: { tenantId?: string | null; olderThan: Date }): Promise<number> {
    const where: Record<string, unknown> = { status: 'processing', lockedAt: { [Op.lt]: input.olderThan } };
    if (input.tenantId) where.tenantId = input.tenantId;
    return this.outboxModel.count({ where: where as never });
  }

  async claimPending(input: { tenantId?: string | null; limit: number; workerId: string }): Promise<OutboxEventModel[]> {
    const eventCodes = registeredEventCodes();
    if (eventCodes.length === 0) return [];
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      const claimed = await this.sequelize.query<{ id: string }>(CLAIM_PENDING_EVENTS_SQL, {
        replacements: {
          eventCodes,
          tenantId: input.tenantId ?? null,
          limit: input.limit,
          now,
          workerId: input.workerId,
        },
        type: QueryTypes.SELECT,
        transaction,
      });

      const ids = claimed.map((row) => String(row.id));
      if (ids.length === 0) return [];
      return this.outboxModel.findAll({
        where: { id: { [Op.in]: ids }, status: 'processing', lockedBy: input.workerId } as never,
        order: [
          ['priority', 'DESC'],
          ['availableAt', 'ASC'],
          ['id', 'ASC'],
        ],
        transaction,
      });
    });
  }
}
