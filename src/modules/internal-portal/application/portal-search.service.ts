/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { containsLikePattern } from '../../../common/utils/strings/like-pattern.util.js';
import { boolValue, clean, containsQuery, id, intValue, parsePage, Query, Row, type Page } from './portal-format.util.js';
import { reportDefinitions } from './portal-report-definitions.js';
import { PortalQueryBase } from './portal-query.base.js';

export const SEARCH_KINDS = ['endpoint', 'table', 'quality_rule', 'report'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Clave de `totals` por tipo: son las que el portal ya pintaba, se conservan. */
const TOTAL_KEY: Record<SearchKind, string> = { endpoint: 'endpoints', table: 'tables', quality_rule: 'qualityRules', report: 'reports' };

type SearchItem = Record<string, unknown> & { id: string; kind: SearchKind };

/**
 * Cada tipo que vive en una tabla: de dónde sale, en qué columnas se busca y cómo se ordena. Las
 * columnas son literales de este archivo, nunca entrada del usuario; lo buscado va por `:like`.
 */
const SQL_SOURCES: Record<Exclude<SearchKind, 'report'>, { select: string; from: string; match: string; order: string }> = {
  endpoint: {
    select: '_id, method, full_path, route_name, module, status, risk_level, contains_pii',
    from: 'system_endpoint_catalog',
    match: 'full_path ILIKE :like OR route_name ILIKE :like OR module ILIKE :like',
    order: 'full_path ASC, _id ASC',
  },
  table: {
    select: '_id, table_name, entity_name, module, status, contains_pii',
    from: 'system_data_entity_catalog',
    match: 'table_name ILIKE :like OR entity_name ILIKE :like OR module ILIKE :like',
    order: 'table_name ASC, _id ASC',
  },
  quality_rule: {
    select: '_id, rule_code, rule_name, severity, is_active',
    from: 'data_quality_rules',
    match: 'rule_code ILIKE :like OR rule_name ILIKE :like OR target_table ILIKE :like',
    order: 'rule_code ASC, _id ASC',
  },
};

function mapRow(kind: Exclude<SearchKind, 'report'>, row: Row): SearchItem {
  if (kind === 'endpoint') {
    return {
      id: `endpoint:${id(row._id)}`,
      kind,
      title: `${clean(row.method)} ${clean(row.full_path)}`,
      subtitle: clean(row.route_name, clean(row.module)),
      href: `/internal/systems/endpoints/${id(row._id)}`,
      status: clean(row.status),
      method: clean(row.method),
      riskLevel: clean(row.risk_level),
      containsPii: boolValue(row.contains_pii),
    };
  }
  if (kind === 'table') {
    return {
      id: `table:${id(row._id)}`,
      kind,
      title: clean(row.entity_name, clean(row.table_name)),
      subtitle: clean(row.table_name),
      href: `/internal/data-catalog/tables/${id(row._id)}`,
      status: clean(row.status),
      containsPii: boolValue(row.contains_pii),
    };
  }
  return {
    id: `quality:${id(row._id)}`,
    kind,
    title: clean(row.rule_name),
    subtitle: clean(row.rule_code),
    href: `/internal/data-quality/rules/${id(row._id)}`,
    status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE',
    riskLevel: clean(row.severity).toUpperCase(),
    containsPii: false,
  };
}

function parseKind(value: unknown): SearchKind | null {
  return SEARCH_KINDS.find((kind) => kind === value) ?? null;
}

/**
 * Búsqueda transversal del portal interno (endpoints, tablas, reglas de calidad y reportes).
 *
 * Antes cada tipo traía un `LIMIT 15` fijo, ignoraba el `limit` pedido y `totals` contaba las filas
 * DEVUELTAS: «Endpoints: 15» quería decir «15 o más», y el resto era inalcanzable. Ahora `totals` es un
 * `COUNT(*)` real por tipo, y cada tipo se pagina con `page`/`limit`:
 * - con `kind`, `items` es una página de ESE tipo y `meta` es su paginación;
 * - sin `kind` (compatibilidad), `items` trae hasta `limit` de CADA tipo y `meta.totalPages` es la del
 *   tipo con más páginas.
 */
export class PortalSearchService extends PortalQueryBase {
  async search(query: Query) {
    const q = clean(query.q, '').trim();
    const kind = parseKind(query.kind);
    const page = parsePage(query);
    if (!q) return { items: [], totals: {}, kind, meta: { page: page.page, limit: page.limit, total: 0, totalPages: 0 } };

    const like = containsLikePattern(q);
    const reports = reportDefinitions().filter((report) => containsQuery(report, q.toLowerCase()));
    const counts = await this.countAll(like, reports.length);
    const kinds = kind ? [kind] : [...SEARCH_KINDS];
    const pages = await Promise.all(kinds.map((each) => this.pageOf(each, like, page, reports)));

    const totalPages = Math.max(0, ...kinds.map((each) => Math.ceil(counts[each] / page.limit)));
    const total = kinds.reduce((sum, each) => sum + counts[each], 0);
    const totals = Object.fromEntries(SEARCH_KINDS.map((each) => [TOTAL_KEY[each], counts[each]]));
    return { items: pages.flat(), totals, kind, meta: { page: page.page, limit: page.limit, total, totalPages } };
  }

  private async countAll(like: string, reportCount: number): Promise<Record<SearchKind, number>> {
    const [endpoint, table, qualityRule] = await Promise.all(
      (['endpoint', 'table', 'quality_rule'] as const).map(async (kind) => {
        const source = SQL_SOURCES[kind];
        const rows = await this.queryRows<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${source.from} WHERE ${source.match}`, {
          like,
        });
        return intValue(rows[0]?.count, 0);
      }),
    );
    return { endpoint, table, quality_rule: qualityRule, report: reportCount };
  }

  private async pageOf(kind: SearchKind, like: string, page: Page, reports: ReturnType<typeof reportDefinitions>): Promise<SearchItem[]> {
    if (kind === 'report') {
      // Los reportes son un catálogo del CÓDIGO, completo en memoria: filtrar y paginar aquí es exacto.
      return reports.slice(page.offset, page.offset + page.limit).map((report) => ({
        id: `report:${report.reportId}`,
        kind,
        title: report.name,
        subtitle: report.description,
        href: `/internal/reports/${report.reportId}`,
        status: report.status,
        riskLevel: report.criticality,
        containsPii: false,
      }));
    }
    const source = SQL_SOURCES[kind];
    const rows = await this.queryRows(
      `SELECT ${source.select} FROM ${source.from} WHERE ${source.match} ORDER BY ${source.order} LIMIT :limit OFFSET :offset`,
      { like, limit: page.limit, offset: page.offset },
    );
    return rows.map((row) => mapRow(kind, row));
  }
}
