/**
 * @file Filtros compartidos de los dos listados de la identidad del comercio.
 * @business Esta pieza controla quién puede operar el canal del comercio afiliado y deja evidencia de cada alta.
 * @system implementa identidad del comercio, credenciales y ciclo de vida de sus usuarios.
 */
import { Op, col, fn, where } from 'sequelize';
import { buildPaginationMeta, PaginationMeta } from '../../common/utils/pagination/pagination.util.js';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';

type ListQuery = { page: number; limit: number; status?: string; email?: string; q?: string };

/**
 * Condiciones del listado: estado exacto, correo EXACTO (lo usa el ERP para saber si una persona ya
 * tiene identidad) y `q`, que busca por partes en las columnas que se le pasan.
 *
 * `q` existe porque el buscador de la pantalla mandaba `email`, que es exacto: escribir «ana@» o el
 * nombre de la persona devolvía una tabla vacía con cara de «no hay nadie».
 */
export function merchantListConditions(base: unknown[], query: ListQuery, searchable: readonly string[]): unknown[] {
  const filters = [...base];
  if (query.status) filters.push({ status: query.status });
  if (query.email) filters.push(where(fn('lower', fn('btrim', col('email'))), query.email.trim().toLowerCase()));
  const q = query.q?.trim();
  if (q) {
    const pattern = containsLikePattern(q);
    filters.push({ [Op.or]: searchable.map((attribute) => ({ [attribute]: { [Op.iLike]: pattern } })) });
  }
  return filters;
}

/** La página con el contrato de siempre (`page`, `limit`, `total`) y además el canónico `meta`. */
export function merchantListPage<T>(items: T[], query: ListQuery, total: number) {
  const meta: PaginationMeta = buildPaginationMeta({ page: query.page, limit: query.limit }, total);
  return { items, page: query.page, limit: query.limit, total, meta };
}
