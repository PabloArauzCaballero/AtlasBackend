/**
 * @file El buscador de la cartera para el personal y el código de cliente de cada préstamo.
 * @business Quien busca un préstamo escribe parte de su código o el código del cliente, no un número exacto.
 * @system arma la condición ILIKE sobre `loan_code` y `customer_code` y resuelve los códigos de cliente de una página.
 */
import { literal, Op, QueryTypes, Sequelize } from 'sequelize';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';

const NUMERIC_ID = /^[1-9][0-9]{0,18}$/;
const customers = (): string => `${atlasSchemaFor('customers')}.customers`;

/**
 * Parte del código del préstamo, parte del código del cliente y, si son sólo dígitos, el número del
 * préstamo o del cliente exactos. El cliente se resuelve por subconsulta: la cartera no carga clientes.
 */
export function loanSearchConditions(tenantId: string, q: string, sequelize: Sequelize): Record<string, unknown>[] {
  const term = q.trim();
  const pattern = containsLikePattern(term.trim());
  const conditions: Record<string, unknown>[] = [
    { loanCode: { [Op.iLike]: pattern } },
    {
      customerId: {
        [Op.in]: literal(
          `(SELECT c._id FROM ${customers()} c WHERE c._tenant_id = ${sequelize.escape(tenantId)} ` +
            `AND COALESCE(c._deleted, false) = false AND c.customer_code ILIKE ${sequelize.escape(pattern)})`,
        ),
      },
    },
  ];
  if (NUMERIC_ID.test(term)) conditions.push({ id: term }, { customerId: term });
  return conditions;
}

/** El código de cliente de cada préstamo de la página, en UNA consulta. */
export async function customerCodesFor(
  sequelize: Sequelize,
  tenantId: string,
  customerIds: readonly string[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await sequelize.query<{ id: string; code: string | null }>(
    `SELECT c._id::text AS id, c.customer_code AS code FROM ${customers()} c WHERE c._tenant_id = $tenantId AND c._id = ANY($ids::bigint[])`,
    { type: QueryTypes.SELECT, bind: { tenantId, ids } },
  );
  return new Map(rows.map((row) => [row.id, row.code]));
}
