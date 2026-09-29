/**
 * @file El filtro del listado del outbox, compartido por la vista por página, la por cursor y el resumen.
 * @business Quien busca un evento escribe parte de su código, del agregado o de la correlación, no el valor exacto.
 * @system traduce `status`, los filtros exactos y el buscador `q` (ILIKE en tres columnas) a un `where` de Sequelize.
 */
import { Op } from 'sequelize';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { ListEventsQueryDto } from './events.schemas.js';

type EventListFilter = Pick<ListEventsQueryDto, 'status' | 'eventCode' | 'aggregateType' | 'correlationId' | 'q'>;

/** `withStatus: false` es para el resumen por estado: cuenta cada estado con el resto de filtros. */
export function eventListWhere(tenantId: string, query: EventListFilter, withStatus = true): Record<string | symbol, unknown> {
  const where: Record<string | symbol, unknown> = { tenantId };
  if (withStatus && query.status) where.status = query.status;
  if (query.eventCode) where.eventCode = query.eventCode;
  if (query.aggregateType) where.aggregateType = query.aggregateType;
  if (query.correlationId) where.correlationId = query.correlationId;
  if (query.q) {
    const pattern = containsLikePattern(query.q.trim());
    where[Op.or] = [
      { eventCode: { [Op.iLike]: pattern } },
      { aggregateType: { [Op.iLike]: pattern } },
      { correlationId: { [Op.iLike]: pattern } },
    ];
  }
  return where;
}
