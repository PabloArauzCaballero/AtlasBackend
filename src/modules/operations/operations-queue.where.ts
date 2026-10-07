/**
 * @file Los filtros de la cola de trabajo, compartidos por la vista por página y la por cursor.
 * @business Quien busca un caso escribe el código del cliente o del caso, no un número interno.
 * @system arma el `where` de revisión manual y de fraude con los mismos filtros y el mismo buscador.
 */
import { literal, Op } from 'sequelize';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';

/** Lo que la cola deja filtrar. `status`/`priority` son `case_status`/`severity` en fraude. */
export type QueueFilter = { status?: string; priority?: string; customerId?: string; q?: string };

/** El `escape` de la conexión: el patrón de búsqueda viaja dentro de una subconsulta literal. */
export type SqlEscape = (value: string) => string;

const NUMERIC_ID = /^[1-9][0-9]{0,18}$/;
/** Máximo de un bigint de Postgres: más allá, la comparación lanza 22003 (500) en vez de dar lista vacía. */
const MAX_BIGINT = 9223372036854775807n;

/**
 * El buscador: código del caso (ILIKE), código del cliente (ILIKE, por subconsulta a `customers`) y,
 * si lo escrito son sólo dígitos, el número del caso o del cliente exactos —que es lo único que la
 * pantalla aceptaba antes—. La subconsulta y no un JOIN: la cola no carga el cliente entero, sólo
 * necesita saber qué clientes coinciden.
 */
function searchConditions(tenantId: string, q: string, escape: SqlEscape): Record<string, unknown>[] {
  const term = q.trim();
  const pattern = containsLikePattern(term.trim());
  const customers = `${atlasSchemaFor('customers')}.customers`;
  const conditions: Record<string, unknown>[] = [
    { caseCode: { [Op.iLike]: pattern } },
    {
      customerId: {
        [Op.in]: literal(
          `(SELECT c._id FROM ${customers} c WHERE c._tenant_id = ${escape(tenantId)} ` +
            `AND COALESCE(c._deleted, false) = false AND c.customer_code ILIKE ${escape(pattern)})`,
        ),
      },
    },
  ];
  if (NUMERIC_ID.test(term) && BigInt(term) <= MAX_BIGINT) conditions.push({ id: term }, { customerId: term });
  return conditions;
}

function base(tenantId: string, filter: QueueFilter, escape: SqlEscape): Record<string | symbol, unknown> {
  return {
    tenantId,
    deleted: { [Op.ne]: true },
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
    ...(filter.q ? { [Op.or]: searchConditions(tenantId, filter.q, escape) } : {}),
  };
}

export function manualReviewQueueWhere(tenantId: string, filter: QueueFilter, escape: SqlEscape): Record<string | symbol, unknown> {
  return {
    ...base(tenantId, filter, escape),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.priority ? { priority: filter.priority } : {}),
  };
}

export function fraudQueueWhere(tenantId: string, filter: QueueFilter, escape: SqlEscape): Record<string | symbol, unknown> {
  return {
    ...base(tenantId, filter, escape),
    ...(filter.status ? { caseStatus: filter.status } : {}),
    ...(filter.priority ? { severity: filter.priority } : {}),
  };
}
