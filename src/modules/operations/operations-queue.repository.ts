/**
 * @file Las consultas de la COLA de trabajo, con y sin cursor.
 * @business Esta pieza deja trazabilidad de la atención y su resultado.
 * @system implementa este tramo del caso de uso de soporte.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op, WhereOptions } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { decodeCursor, encodeCursor } from '../../common/utils/pagination/cursor-pagination.util.js';
import {
  CustomerObservationModel,
  CustomerStatusEventModel,
  DataChangeLogModel,
  FraudCaseModel,
  IdentityVerificationAttemptModel,
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

/**
 * Salen de `OperationsRepository` porque son cuatro consultas paginadas —dos por página y dos por
 * cursor, sobre revisión manual y fraude— que juntas ocupaban más que todo lo demás del
 * repositorio. Lo que queda allí son lecturas y escrituras de una fila concreta.
 */
@Injectable()
export class OperationsQueueRepository {
  constructor(
    @InjectModel(ManualReviewCaseModel) private readonly manualReviewCaseModel: typeof ManualReviewCaseModel,
    @InjectModel(FraudCaseModel) private readonly fraudCaseModel: typeof FraudCaseModel,
    @InjectModel(ManualReviewEventModel) private readonly manualReviewEventModel: typeof ManualReviewEventModel,
    @InjectModel(CustomerStatusEventModel) private readonly customerStatusEventModel: typeof CustomerStatusEventModel,
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
    @InjectModel(DataChangeLogModel) private readonly dataChangeLogModel: typeof DataChangeLogModel,
    @InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel,
    @InjectModel(IdentityVerificationAttemptModel)
    private readonly identityAttemptModel: typeof IdentityVerificationAttemptModel,
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
}
