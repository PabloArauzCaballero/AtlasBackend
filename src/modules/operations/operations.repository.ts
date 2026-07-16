import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op, Transaction, WhereOptions } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { decodeCursor, encodeCursor } from '../../common/utils/pagination/cursor-pagination.util.js';
import {
  CustomerObservationModel,
  CustomerStatusEventModel,
  DataChangeLogModel,
  FraudCaseModel,
  ManualReviewCaseModel,
  ManualReviewEventModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';
import { WorkQueueQueryDto } from './operations.schemas.js';

/**
 * Repositorio de operaciones.
 *
 * Las escrituras de decisión de fraude viven en `FraudRepository`; este repositorio mantiene
 * lecturas de casos de fraude para colas e investigation summary.
 */
@Injectable()
export class OperationsRepository {
  constructor(
    @InjectModel(ManualReviewCaseModel) private readonly manualReviewCaseModel: typeof ManualReviewCaseModel,
    @InjectModel(FraudCaseModel) private readonly fraudCaseModel: typeof FraudCaseModel,
    @InjectModel(ManualReviewEventModel) private readonly manualReviewEventModel: typeof ManualReviewEventModel,
    @InjectModel(CustomerStatusEventModel) private readonly customerStatusEventModel: typeof CustomerStatusEventModel,
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
    @InjectModel(DataChangeLogModel) private readonly dataChangeLogModel: typeof DataChangeLogModel,
    @InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel,
  ) {}

  async findManualReviewCasesForQueue(tenantId: string, query: WorkQueueQueryDto) {
    const where: WhereOptions = {
      tenantId,
      deleted: { [Op.ne]: true },
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const orderField = query.sortBy === 'updatedAt' ? 'updatedAtValue' : 'createdAtValue';
    const orderDir = query.sortOrder.toUpperCase() as 'ASC' | 'DESC';

    const result = await this.manualReviewCaseModel.findAndCountAll({
      where,
      order: [
        [orderField, orderDir],
        ['id', 'DESC'],
      ],
      limit: query.limit,
      offset: toOffset({ page: query.page, limit: query.limit }),
    } as FindAndCountOptions);

    return {
      rows: result.rows,
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, result.count),
    };
  }

  /**
   * ATLAS-P11-T10 (continúa ATLAS-PEND-102 / RC-06, siguiendo el mismo patrón ya aplicado en
   * `data-quality.repository.ts::findIssuesWithCursor` y `events.repository.ts::listWithCursor`):
   * variante por cursor de `findManualReviewCasesForQueue()`. Respeta el mismo campo de orden
   * dinámico (`createdAtValue` o `updatedAtValue`, según `query.sortBy`) que la versión OFFSET,
   * por lo que el cursor codifica el valor de *ese* campo, no siempre `createdAt` — el nombre
   * `createdAt` dentro de `CursorKey` es solo la etiqueta del campo de ordenamiento usado, no
   * necesariamente la columna `created_at`.
   *
   * `findManualReviewCasesForQueue()` (OFFSET) se mantiene sin cambios por compatibilidad. Esta
   * es la variante recomendada para listados nuevos de alto volumen del panel de operaciones.
   *
   * Nota de alcance: `getWorkQueue()` combina esta cola con `findFraudCasesForQueueWithCursor()`
   * en una sola vista mezclada para el operador. Fusionar dos fuentes de cursor heterogéneas en
   * una sola página ordenada es un problema estructuralmente equivalente al fan-in de 5 tablas
   * de `audit.repository.ts` (ver `ATLAS-PEND-102`): requiere una vista unificada, no solo un
   * cambio de repositorio. Por eso `getWorkQueue()` sigue usando las variantes OFFSET por ahora;
   * las variantes por cursor de este archivo quedan listas para exponerse como endpoints propios
   * no combinados (`GET /operations/manual-review-cases`, `GET /operations/fraud-cases`) sin
   * esperar a que se resuelva la fusión completa.
   */
  async findManualReviewCasesForQueueWithCursor(
    tenantId: string,
    query: { status?: string; priority?: string; customerId?: string; sortBy: 'createdAt' | 'updatedAt'; limit: number; cursor?: string },
  ): Promise<{ items: ManualReviewCaseModel[]; nextCursor: string | null }> {
    const orderField = query.sortBy === 'updatedAt' ? 'updatedAtValue' : 'createdAtValue';

    const where: Record<string, unknown> = {
      tenantId,
      deleted: { [Op.ne]: true },
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const cursorKey = decodeCursor(query.cursor);
    if (cursorKey) {
      where[Op.and as unknown as string] = [
        {
          [Op.or]: [
            { [orderField]: { [Op.lt]: new Date(cursorKey.createdAt) } },
            { [Op.and]: [{ [orderField]: new Date(cursorKey.createdAt) }, { id: { [Op.lt]: cursorKey.id } }] },
          ],
        },
      ];
    }

    const rowsPlusOne = await this.manualReviewCaseModel.findAll({
      where: where as never,
      order: [
        [orderField, 'DESC'],
        ['id', 'DESC'],
      ],
      limit: query.limit + 1,
    } as FindOptions);

    const hasMore = rowsPlusOne.length > query.limit;
    const items = hasMore ? rowsPlusOne.slice(0, query.limit) : rowsPlusOne;
    const last = items[items.length - 1] as (ManualReviewCaseModel & Record<string, unknown>) | undefined;
    const lastOrderValue = last ? (last[orderField] as Date | undefined) : undefined;
    const nextCursor = hasMore && last && lastOrderValue ? encodeCursor({ createdAt: lastOrderValue.toISOString(), id: last.id }) : null;

    return { items, nextCursor };
  }

  async findFraudCasesForQueue(tenantId: string, query: WorkQueueQueryDto) {
    const where: WhereOptions = {
      tenantId,
      deleted: { [Op.ne]: true },
      ...(query.status ? { caseStatus: query.status } : {}),
      ...(query.priority ? { severity: query.priority } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const orderField = query.sortBy === 'updatedAt' ? 'updatedAtValue' : 'createdAtValue';
    const orderDir = query.sortOrder.toUpperCase() as 'ASC' | 'DESC';

    const result = await this.fraudCaseModel.findAndCountAll({
      where,
      order: [
        [orderField, orderDir],
        ['id', 'DESC'],
      ],
      limit: query.limit,
      offset: toOffset({ page: query.page, limit: query.limit }),
    } as FindAndCountOptions);

    return {
      rows: result.rows,
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, result.count),
    };
  }

  /**
   * ATLAS-P11-T10: variante por cursor de `findFraudCasesForQueue()`, mismo patrón y misma nota
   * de alcance que `findManualReviewCasesForQueueWithCursor()` — ver el comentario allí.
   */
  async findFraudCasesForQueueWithCursor(
    tenantId: string,
    query: { status?: string; priority?: string; customerId?: string; sortBy: 'createdAt' | 'updatedAt'; limit: number; cursor?: string },
  ): Promise<{ items: FraudCaseModel[]; nextCursor: string | null }> {
    const orderField = query.sortBy === 'updatedAt' ? 'updatedAtValue' : 'createdAtValue';

    const where: Record<string, unknown> = {
      tenantId,
      deleted: { [Op.ne]: true },
      ...(query.status ? { caseStatus: query.status } : {}),
      ...(query.priority ? { severity: query.priority } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const cursorKey = decodeCursor(query.cursor);
    if (cursorKey) {
      where[Op.and as unknown as string] = [
        {
          [Op.or]: [
            { [orderField]: { [Op.lt]: new Date(cursorKey.createdAt) } },
            { [Op.and]: [{ [orderField]: new Date(cursorKey.createdAt) }, { id: { [Op.lt]: cursorKey.id } }] },
          ],
        },
      ];
    }

    const rowsPlusOne = await this.fraudCaseModel.findAll({
      where: where as never,
      order: [
        [orderField, 'DESC'],
        ['id', 'DESC'],
      ],
      limit: query.limit + 1,
    } as FindOptions);

    const hasMore = rowsPlusOne.length > query.limit;
    const items = hasMore ? rowsPlusOne.slice(0, query.limit) : rowsPlusOne;
    const last = items[items.length - 1] as (FraudCaseModel & Record<string, unknown>) | undefined;
    const lastOrderValue = last ? (last[orderField] as Date | undefined) : undefined;
    const nextCursor = hasMore && last && lastOrderValue ? encodeCursor({ createdAt: lastOrderValue.toISOString(), id: last.id }) : null;

    return { items, nextCursor };
  }

  findOpenManualReviewCasesForCustomer(tenantId: string, customerId: string): Promise<ManualReviewCaseModel[]> {
    return this.manualReviewCaseModel.findAll({
      where: {
        tenantId,
        customerId,
        deleted: { [Op.ne]: true },
        closedAt: null,
      },
      order: [
        ['openedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: 10,
    } as FindOptions);
  }

  findFraudCasesForCustomer(tenantId: string, customerId: string): Promise<FraudCaseModel[]> {
    return this.fraudCaseModel.findAll({
      where: {
        tenantId,
        customerId,
        deleted: { [Op.ne]: true },
      },
      order: [
        ['openedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: 10,
    } as FindOptions);
  }
  findManualReviewCaseById(tenantId: string, caseId: string): Promise<ManualReviewCaseModel | null> {
    return this.manualReviewCaseModel.findOne({ where: { tenantId, id: caseId, deleted: { [Op.ne]: true } } } as FindOptions);
  }

  // Las escrituras de fraude viven en `FraudRepository`.

  async closeManualReviewCase(
    caseModel: ManualReviewCaseModel,
    values: { resolution: string; notes: string | null; closedAt: Date },
    options: { transaction?: Transaction },
  ): Promise<ManualReviewCaseModel> {
    caseModel.status = 'closed';
    caseModel.resolution = values.resolution;
    caseModel.notes = values.notes;
    caseModel.closedAt = values.closedAt;
    caseModel.updatedAtValue = values.closedAt;
    return caseModel.save({ transaction: options.transaction });
  }

  createManualReviewEvent(
    values: {
      tenantId: string;
      caseId: string;
      eventType: string;
      actorType: string;
      actorInternalUserId: string | null;
      payload: Record<string, unknown>;
      notes: string | null;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<ManualReviewEventModel> {
    return this.manualReviewEventModel.create(
      {
        tenantId: values.tenantId,
        manualReviewCaseId: values.caseId,
        eventType: values.eventType,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        happenedAt: values.happenedAt,
        payloadJson: values.payload,
        notes: values.notes,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  // Status events y observaciones se usan tanto por manual review como por fraude.

  createStatusEvent(
    values: {
      tenantId: string;
      customerId: string;
      previousStatus: string | null;
      newStatus: string;
      reasonCode: string;
      actorType: string;
      actorInternalUserId: string | null;
      happenedAt: Date;
      notes: string | null;
    },
    options: { transaction?: Transaction },
  ): Promise<CustomerStatusEventModel> {
    return this.customerStatusEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        previousStatus: values.previousStatus,
        newStatus: values.newStatus,
        reasonCode: values.reasonCode,
        changedByType: values.actorType,
        changedByInternalUserId: values.actorInternalUserId,
        happenedAt: values.happenedAt,
        notes: values.notes,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createCustomerObservation(
    values: { tenantId: string; customerId: string; observationCode: string; payload: Record<string, unknown>; happenedAt: Date },
    options: { transaction?: Transaction },
  ): Promise<CustomerObservationModel> {
    return this.customerObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: null,
        deviceId: null,
        observationCode: values.observationCode,
        valueText: null,
        valueNumber: null,
        valueBoolean: null,
        valueJson: values.payload,
        sourceType: 'operations',
        sourceProviderId: null,
        evidenceId: null,
        confidenceScore: null,
        verificationStatus: 'operator_decision',
        capturedAt: values.happenedAt,
        validFrom: values.happenedAt,
        validUntil: null,
        derivationMethod: null,
        derivationVersion: null,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  // Las escrituras de watchlist de fraude viven en `FraudRepository`.

  createOperationalAudit(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId: string | null;
      actionCode: string;
      targetType: string;
      targetId: string;
      payload: Record<string, unknown>;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<OperationalAuditLogModel> {
    return this.operationalAuditLogModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actorPlatformUserId: null,
        actionCode: values.actionCode,
        targetType: values.targetType,
        targetId: values.targetId,
        ipAddress: null,
        userAgent: null,
        payloadJson: values.payload,
        occurredAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createDataChange(
    values: {
      tenantId: string;
      tableName: string;
      recordId: string;
      changeType: string;
      actorType: string;
      actorInternalUserId: string | null;
      reason: string;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<DataChangeLogModel> {
    return this.dataChangeLogModel.create(
      {
        tenantId: values.tenantId,
        tableName: values.tableName,
        recordId: values.recordId,
        changeType: values.changeType,
        changedByType: values.actorType,
        changedByInternalUserId: values.actorInternalUserId,
        changedByPlatformUserId: null,
        oldValuesHash: null,
        newValuesHash: null,
        changeReason: values.reason,
        changedAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }
}
