/**
 * @file Utilidad de persistencia: qué filas de consultas a proveedores cuentan como respuesta del proveedor.
 * @business Esta pieza evita que el disyuntor se mantenga abierto por los rechazos del propio Atlas.
 * @system el `where` Sequelize del conteo; el filtro usa Postgres `NOT LIKE ALL` sobre `response_code`.
 */
import { Op } from 'sequelize';

/**
 * Códigos con los que Atlas rechaza una consulta SIN llamar al proveedor. No dicen nada de la salud
 * del proveedor, así que el disyuntor no los cuenta: si lo hiciera, sus propios rechazos (y las
 * cuotas internas) lo mantendrían abierto mientras hubiera tráfico, con el proveedor sano.
 */
export const POLICY_BLOCK_CODE_PATTERNS = [
  '%\\_CIRCUIT\\_BREAKER\\_OPEN',
  '%\\_QUOTA\\_EXCEEDED',
  'PRODUCTION\\_GATE\\_BLOCKED%',
  '%\\_PROVIDER\\_DISABLED',
];

export type ProviderRequestCountQuery = {
  providerId: string;
  customerId?: string;
  from: Date;
  to?: Date;
  statuses?: string[];
  /** Deja fuera las filas que Atlas rechazó sin llamar al proveedor (cuota, disyuntor, portón). */
  onlyProviderOutcomes?: boolean;
};

/** El `where` del conteo: proveedor y ventana, y opcionalmente cliente, estados y sólo respuestas del proveedor. */
export function providerRequestCountWhere(input: ProviderRequestCountQuery): Record<string | symbol, unknown> {
  const where: Record<string | symbol, unknown> = { providerId: input.providerId, requestedAt: { [Op.gte]: input.from } };
  if (input.to) where.requestedAt = { [Op.gte]: input.from, [Op.lt]: input.to };
  if (input.customerId) where.customerId = input.customerId;
  if (input.statuses?.length) where.responseStatus = { [Op.in]: input.statuses };
  if (input.onlyProviderOutcomes) {
    where[Op.or] = [{ responseCode: null }, { responseCode: { [Op.notLike]: { [Op.all]: POLICY_BLOCK_CODE_PATTERNS } } }];
  }
  return where;
}
