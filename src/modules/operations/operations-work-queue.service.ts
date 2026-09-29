/**
 * @file Caso de uso: la cola de trabajo (revisión manual + fraude), por página y por cursor.
 * @business Operaciones ve cuántos casos esperan en cada cola y los busca por el código que conoce.
 * @system pagina las dos colas, las cuenta para las pestañas, resuelve el código del cliente y acota a fraude a quien sólo ve fraude.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { buildPaginationMeta } from '../../common/utils/pagination/pagination.util.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CursorWorkQueueResponseDto, PaginatedWorkQueueResponseDto, WorkQueueItemDto, WorkQueueSummaryDto } from './operations.dtos.js';
import { toFraudWorkItem, toManualReviewWorkItem } from './operations.mapper.js';
import { OperationsQueueRepository } from './operations-queue.repository.js';
import { CursorWorkQueueQueryDto, WorkQueueQueryDto } from './operations.schemas.js';

/**
 * Roles que entran a la cola SÓLO para la parte de fraude.
 *
 * `fraud_analyst` veía los casos de fraude por su ruta propia y no entraba a la cola combinada. Al
 * fusionar las pantallas se le abre `work-queue`, pero con `queue=fraud` y nada más: ni filas ni
 * cifras de revisión manual, que antes tampoco veía. Lo que no amplía es su acceso a datos.
 */
export const FRAUD_ONLY_QUEUE_ROLES: readonly string[] = ['fraud_analyst'];

@Injectable()
export class OperationsWorkQueueService {
  constructor(
    private readonly cola: OperationsQueueRepository,
    private readonly customersRepository: CustomersRepository,
  ) {}

  async getManualReviewCasesCursorPage(tenantId: string, query: CursorWorkQueueQueryDto): Promise<CursorWorkQueueResponseDto> {
    const [result, total] = await Promise.all([
      this.cola.findManualReviewCasesForQueueWithCursor(tenantId, query),
      this.cola.countManualReviewCases(tenantId, query),
    ]);
    const items = await this.withCustomerCodes(tenantId, result.items.map(toManualReviewWorkItem));
    return { items, nextCursor: result.nextCursor, total };
  }

  async getFraudCasesCursorPage(tenantId: string, query: CursorWorkQueueQueryDto): Promise<CursorWorkQueueResponseDto> {
    const [result, total] = await Promise.all([
      this.cola.findFraudCasesForQueueWithCursor(tenantId, query),
      this.cola.countFraudCases(tenantId, query),
    ]);
    const items = await this.withCustomerCodes(tenantId, result.items.map(toFraudWorkItem));
    return { items, nextCursor: result.nextCursor, total };
  }

  async getWorkQueue(tenantId: string, query: WorkQueueQueryDto, actorRole?: string): Promise<PaginatedWorkQueueResponseDto> {
    const fraudOnly = actorRole !== undefined && FRAUD_ONLY_QUEUE_ROLES.includes(actorRole);
    if (fraudOnly && query.queue !== 'fraud') {
      // 403 explícito y no una cola «recortada» en silencio: quien pide `all` con este rol tiene
      // que saber que la revisión manual no es suya, no creer que está vacía.
      throw new ForbiddenException('WORK_QUEUE_FRAUD_ONLY: con tu rol sólo puedes ver la cola de fraude (queue=fraud).');
    }

    if (query.queue === 'manual_review') {
      const [result, fraudTotal] = await Promise.all([
        this.cola.findManualReviewCasesForQueue(tenantId, query),
        this.cola.countFraudCases(tenantId, query),
      ]);
      return {
        items: await this.withCustomerCodes(tenantId, result.rows.map(toManualReviewWorkItem)),
        meta: result.meta,
        summary: { byType: { manual_review: result.meta.total, fraud: fraudTotal } },
      };
    }

    if (query.queue === 'fraud') {
      const [result, manualTotal] = await Promise.all([
        this.cola.findFraudCasesForQueue(tenantId, query),
        fraudOnly ? Promise.resolve(null) : this.cola.countManualReviewCases(tenantId, query),
      ]);
      const byType: WorkQueueSummaryDto['byType'] = { fraud: result.meta.total };
      if (manualTotal !== null) byType.manual_review = manualTotal;
      return {
        items: await this.withCustomerCodes(tenantId, result.rows.map(toFraudWorkItem)),
        meta: result.meta,
        summary: { byType },
      };
    }

    // queue === 'all': cada fuente se pagina con su propio OFFSET/LIMIT independiente, así que no
    // se puede pedirle a cada una "la página N" y mezclar esos dos resultados ya recortados — el
    // corte global de la unión ordenada no coincide con la unión de dos cortes locales (a partir
    // de la página 2 esto salteaba o duplicaba casos según cómo se distribuyeran las dos colas).
    // Fix: pedir a cada fuente sus primeros `page*limit` elementos (offset 0), que por definición
    // contienen todo lo que puede aportar esa fuente al top-`page*limit` de la unión ordenada, y
    // recién ahí mezclar, ordenar y cortar una sola vez en el rango [start, start+limit).
    const topK = query.page * query.limit;
    const topKQuery = { ...query, page: 1, limit: topK };
    const [manualResult, fraudResult] = await Promise.all([
      this.cola.findManualReviewCasesForQueue(tenantId, topKQuery),
      this.cola.findFraudCasesForQueue(tenantId, topKQuery),
    ]);

    const allItems = [...manualResult.rows.map(toManualReviewWorkItem), ...fraudResult.rows.map(toFraudWorkItem)].sort((a, b) => {
      const dateA = a.openedAt ?? a.createdAt;
      const dateB = b.openedAt ?? b.createdAt;
      return query.sortOrder === 'asc' ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
    });

    const totalCount = manualResult.meta.total + fraudResult.meta.total;
    const start = (query.page - 1) * query.limit;

    return {
      items: await this.withCustomerCodes(tenantId, allItems.slice(start, start + query.limit)),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, totalCount),
      summary: { byType: { manual_review: manualResult.meta.total, fraud: fraudResult.meta.total } },
    };
  }

  /** El código de cliente de toda la página en UNA consulta, no uno por fila. */
  private async withCustomerCodes(tenantId: string, items: WorkQueueItemDto[]): Promise<WorkQueueItemDto[]> {
    const ids = [...new Set(items.map((item) => item.customerId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return items;
    const customers = await this.customersRepository.findManyByIds(tenantId, ids);
    const codes = new Map(customers.map((customer) => [String(customer.id), customer.customerCode ?? null]));
    return items.map((item) => ({ ...item, customerCode: item.customerId ? (codes.get(item.customerId) ?? null) : null }));
  }
}
