/**
 * @file Consulta de lectura: resuelve en SQL un listado paginado y sus conteos.
 * @business Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
 * @system implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.
 */
import { FindAndCountOptions, FindOptions, literal, Op, WhereOptions } from 'sequelize';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { ContextCatalogModel } from '../../database/models/index.js';
import { ListCatalogsQueryDto } from './catalog-list.schemas.js';

/** Estados de versión admitidos por `listCatalogsQuerySchema` (literales: nunca entrada libre en el SQL). */
const VERSION_STATUSES = new Set(['draft', 'pending_approval', 'approved', 'published', 'retired']);

/**
 * Ids de catálogo cuya versión MÁS RECIENTE tiene ese estado. «Más reciente» con el mismo orden que
 * `findLatestVersionsByCatalogIds` (`valid_from DESC, _id DESC`), que es la versión que pinta la fila.
 */
export function latestVersionWithStatus(status: string): string {
  if (!VERSION_STATUSES.has(status)) throw new Error(`Estado de versión no admitido: ${status}`);
  return (
    `(SELECT latest.catalog_id FROM (SELECT DISTINCT ON (v.catalog_id) v.catalog_id, v.status FROM context_catalog_versions v ` +
    `ORDER BY v.catalog_id, v.valid_from DESC, v._id DESC) latest WHERE latest.status = '${status}')`
  );
}

/**
 * `q` busca «contiene» en código, nombre, dominio y equipo dueño; `domain` sigue siendo igualdad; el
 * estado se resuelve contra la versión más reciente en SQL (antes se filtraba en memoria, después
 * de traer todos los catálogos, y por eso no se podía paginar).
 */
export function catalogListWhere(query: ListCatalogsQueryDto): WhereOptions {
  const conditions: WhereOptions[] = [];
  if (query.domain) conditions.push({ domain: query.domain });
  if (query.active === 'true') conditions.push({ isActive: true });
  if (query.active === 'false') conditions.push({ isActive: false });
  if (query.status && query.status !== 'all') conditions.push({ id: { [Op.in]: literal(latestVersionWithStatus(query.status)) } });
  if (query.q) {
    const pattern = containsLikePattern(query.q);
    conditions.push({
      [Op.or]: ['catalogCode', 'catalogName', 'domain', 'ownerTeam'].map((field) => ({ [field]: { [Op.iLike]: pattern } })),
    });
  }
  return { [Op.and]: conditions };
}

/**
 * Una página de catálogos con el filtro entero resuelto en SQL. Antes era un `findAll` sin límite.
 * `summary` usa el mismo filtro: son las tarjetas de la pantalla (antes, `length` de la lista).
 */
export async function listCatalogPage(catalogModel: typeof ContextCatalogModel, query: ListCatalogsQueryDto) {
  const where = catalogListWhere(query);
  const count = (extra: WhereOptions) => catalogModel.count({ where: { [Op.and]: [where, extra] } } as FindOptions);
  const [page, active, published, withoutVersion] = await Promise.all([
    catalogModel.findAndCountAll({
      where,
      order: [['catalogCode', 'ASC']],
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    } as FindAndCountOptions),
    count({ isActive: true }),
    count({ id: { [Op.in]: literal(latestVersionWithStatus('published')) } }),
    count({ id: { [Op.notIn]: literal('(SELECT v.catalog_id FROM context_catalog_versions v WHERE v.catalog_id IS NOT NULL)') } }),
  ]);
  return { rows: page.rows, total: page.count, summary: { total: page.count, active, published, withoutVersion } };
}
