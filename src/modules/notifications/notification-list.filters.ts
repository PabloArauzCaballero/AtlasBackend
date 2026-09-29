/**
 * @file Filtros compartidos de los listados de mensajes y plantillas: búsqueda por texto y ventana de fechas.
 * @business Esta pieza deja auditar qué se comunicó a clientes y equipo, y encontrarlo sin conocer su identificador exacto.
 * @system añade condiciones a un WHERE de Sequelize sin pisar las que ya lleva (p. ej. la vigencia en `Op.and`).
 */
import { Op } from 'sequelize';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';

type Where = Record<string | symbol, unknown>;

/** Añade una condición al `Op.and` del WHERE, conservando las que ya tuviera. */
function andAlso(where: Where, condition: unknown): void {
  const current = where[Op.and];
  where[Op.and] = [...(Array.isArray(current) ? current : current ? [current] : []), condition];
}

/**
 * Busca `q` por partes, sin distinguir mayúsculas, en los atributos que se le pasan. Los listados sólo
 * aceptaban identificadores EXACTOS (un `correlationId`, un `code`): sin tenerlo delante no había forma
 * de encontrar un mensaje o una plantilla.
 */
export function withTextSearch(where: Where, q: string | undefined, attributes: readonly string[]): void {
  const text = q?.trim();
  if (!text) return;
  const pattern = containsLikePattern(text);
  andAlso(where, { [Op.or]: attributes.map((attribute) => ({ [attribute]: { [Op.iLike]: pattern } })) });
}

/** La ventana `from`–`to` sobre la fecha de creación, con cualquiera de los dos extremos abierto. */
export function withCreatedBetween(where: Where, range: { from?: Date; to?: Date }): void {
  if (!range.from && !range.to) return;
  where.createdAtValue = {
    ...(range.from ? { [Op.gte]: range.from } : {}),
    ...(range.to ? { [Op.lte]: range.to } : {}),
  };
}
