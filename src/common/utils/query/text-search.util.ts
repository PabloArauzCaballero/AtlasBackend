/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza deja encontrar registros por parte de su texto en cualquier listado del portal, sin conocer su identificador exacto.
 * @system añade una condición de búsqueda `ILIKE` a un WHERE de Sequelize sin pisar las que ya lleva (p. ej. en `Op.and`).
 */
import { Op } from 'sequelize';
import { containsLikePattern } from '../strings/like-pattern.util.js';

type Where = Record<string | symbol, unknown>;

/** Añade una condición al `Op.and` del WHERE, conservando las que ya tuviera. */
export function andAlso(where: Where, condition: unknown): void {
  const current = where[Op.and];
  where[Op.and] = [...(Array.isArray(current) ? current : current ? [current] : []), condition];
}

/**
 * Busca `q` por partes, sin distinguir mayúsculas, en los atributos que se le pasan. Los comodines
 * del usuario (`%`, `_`) se escapan: buscar `50%` busca ese texto y no «50 seguido de lo que sea».
 */
export function withTextSearch(where: Where, q: string | undefined, attributes: readonly string[]): void {
  const text = q?.trim();
  if (!text) return;
  const pattern = containsLikePattern(text);
  andAlso(where, { [Op.or]: attributes.map((attribute) => ({ [attribute]: { [Op.iLike]: pattern } })) });
}
