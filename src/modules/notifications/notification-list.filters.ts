/**
 * @file Filtros compartidos de los listados de mensajes y plantillas: búsqueda por texto y ventana de fechas.
 * @business Esta pieza deja auditar qué se comunicó a clientes y equipo, y encontrarlo sin conocer su identificador exacto.
 * @system añade condiciones a un WHERE de Sequelize sin pisar las que ya lleva (p. ej. la vigencia en `Op.and`).
 */
import { Op } from 'sequelize';

import { withTextSearch } from '../../common/utils/query/text-search.util.js';

type Where = Record<string | symbol, unknown>;

export { withTextSearch };

/** La ventana `from`–`to` sobre la fecha de creación, con cualquiera de los dos extremos abierto. */
export function withCreatedBetween(where: Where, range: { from?: Date; to?: Date }): void {
  if (!range.from && !range.to) return;
  where.createdAtValue = {
    ...(range.from ? { [Op.gte]: range.from } : {}),
    ...(range.to ? { [Op.lte]: range.to } : {}),
  };
}
