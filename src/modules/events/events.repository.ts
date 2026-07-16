import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { redactSensitiveObject } from '../../common/utils/privacy/redaction.util.js';
import { OutboxEventModel } from '../../database/models/index.js';
import { getEventDefinition, listEventDefinitions } from './event-registry.js';
import { ListEventsQueryDto } from './events.schemas.js';
import { PublishEventInput } from './event-types.js';

function registeredEventCodes(): string[] {
  return listEventDefinitions().map((event) => event.code);
}

@Injectable()
export class EventsRepository {
  constructor(
    @InjectModel(OutboxEventModel) private readonly outboxModel: typeof OutboxEventModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async createEvent(input: PublishEventInput): Promise<OutboxEventModel> {
    const definition = getEventDefinition(input.eventCode);
    const now = new Date();

    if (input.idempotencyKey) {
      const existing = await this.outboxModel.findOne({
        where: { tenantId: input.tenantId, eventCode: input.eventCode, idempotencyKey: input.idempotencyKey },
      });
      if (existing) return existing;
    }

    try {
      return await this.outboxModel.create({
        tenantId: input.tenantId,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId ?? null,
        eventCode: input.eventCode,
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
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
        sourceModule: input.sourceModule ?? null,
        sourceAction: input.sourceAction ?? null,
        createdAtValue: now,
        updatedAtValue: now,
      });
    } catch (error) {
      if (!input.idempotencyKey) throw error;
      const existing = await this.outboxModel.findOne({
        where: { tenantId: input.tenantId, eventCode: input.eventCode, idempotencyKey: input.idempotencyKey },
      });
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

  async claimPending(input: { tenantId?: string | null; limit: number; workerId: string }): Promise<OutboxEventModel[]> {
    const eventCodes = registeredEventCodes();
    if (eventCodes.length === 0) return [];
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      const claimed = await this.sequelize.query<{ id: string }>(
        `
        WITH candidates AS (
          SELECT _id
          FROM outbox_events
          WHERE status = 'pending'
            AND event_code IN (:eventCodes)
            AND COALESCE(available_at, now()) <= now()
            AND (:tenantId IS NULL OR _tenant_id = CAST(:tenantId AS BIGINT))
          ORDER BY priority DESC NULLS LAST, available_at ASC NULLS FIRST, _id ASC
          LIMIT :limit
          FOR UPDATE SKIP LOCKED
        )
        UPDATE outbox_events AS event
        SET status = 'processing',
            locked_at = :now,
            locked_by = :workerId,
            attempts = COALESCE(event.attempts, 0) + 1,
            _updated_at = :now
        FROM candidates
        WHERE event._id = candidates._id
        RETURNING event._id AS id;
      `,
        {
          replacements: {
            eventCodes,
            tenantId: input.tenantId ?? null,
            limit: input.limit,
            now,
            workerId: input.workerId,
          },
          type: QueryTypes.SELECT,
          transaction,
        },
      );

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
