/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { NotFoundException } from '@nestjs/common';
import { containsLikePattern } from '../../../common/utils/strings/like-pattern.util.js';
import { pendingIssueSql } from '../../../common/utils/data-quality-issue-status.util.js';
import { boolValue, clean, id, intValue, iso, jsonValue, nullableText, parsePage, Query, Row } from './portal-format.util.js';
import { PortalQueryBase } from './portal-query.base.js';
import { PortalScope, scopeReplacements, tenantPredicate } from './portal-scope.util.js';

/**
 * Reglas de calidad de datos del portal interno.
 *
 * `data_quality_rules` es catálogo de plataforma (no lleva `_tenant_id`), pero el conteo de issues
 * abiertos se calcula sobre `data_quality_issues`, que SÍ lo lleva: sin acotarlo, cada tenant veía
 * un `openIssues` inflado con los incidentes de los demás (ATLAS-SEC-009).
 */
/** Severidad normalizada: la siembra la guarda en minúscula y el portal filtra en mayúscula. */
const SEVERITY_SQL = `UPPER(COALESCE(r.severity, 'medium'))`;
/** Orden por gravedad real; `severity DESC` alfabético ponía MEDIUM antes que CRITICAL. */
const SEVERITY_RANK_SQL = `CASE ${SEVERITY_SQL} WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END`;

export class PortalDataQualityService extends PortalQueryBase {
  /**
   * `q` busca en código, nombre, tabla y campo (lo que dice el buscador del portal). `severity` y
   * `status` filtran de verdad: antes el esquema los descartaba. `summary` cuenta con el MISMO
   * `WHERE` que la página, para que «Críticas» e «Incidencias pendientes» no sean cifras de 20 filas.
   */
  async listDataQualityRules(scope: PortalScope, query: Query) {
    const page = parsePage(query);
    const q = clean(query.q, '');
    const severity = clean(query.severity, '').toUpperCase();
    const status = clean(query.status, '').toUpperCase();
    const filters = { q, like: containsLikePattern(q), severity, status };
    const where =
      `(:q = '' OR r.rule_code ILIKE :like OR r.rule_name ILIKE :like OR r.target_table ILIKE :like OR COALESCE(r.target_field,'') ILIKE :like)` +
      ` AND (:severity = '' OR ${SEVERITY_SQL} = :severity)` +
      ` AND (:status = '' OR (CASE WHEN COALESCE(r.is_active, true) THEN 'ACTIVE' ELSE 'INACTIVE' END) = :status)`;
    const pendingJoin = `LEFT JOIN data_quality_issues i ON i.quality_rule_id = r._id AND ${tenantPredicate(scope, 'i')} AND ${pendingIssueSql('i')}`;
    const [rows, totals] = await Promise.all([
      this.queryRows(
        `SELECT r._id, r.rule_code, r.rule_name, r.target_table, r.target_field, r.severity, r.expression_json,
                r.expected_action, r.build_phase, r.is_active, r._updated_at,
                COUNT(i._id)::int AS open_issues
           FROM data_quality_rules r
           ${pendingJoin}
          WHERE ${where}
          GROUP BY r._id
          ORDER BY ${SEVERITY_RANK_SQL} ASC, r.rule_code ASC
          LIMIT :limit OFFSET :offset`,
        { ...filters, limit: page.limit, offset: page.offset, ...scopeReplacements(scope) },
      ),
      this.queryRows<{ total: string; critical: string; active: string; pending_issues: string }>(
        `SELECT COUNT(DISTINCT r._id)::text AS total,
                COUNT(DISTINCT r._id) FILTER (WHERE ${SEVERITY_SQL} = 'CRITICAL')::text AS critical,
                COUNT(DISTINCT r._id) FILTER (WHERE COALESCE(r.is_active, true))::text AS active,
                COUNT(i._id)::text AS pending_issues
           FROM data_quality_rules r
           ${pendingJoin}
          WHERE ${where}`,
        { ...filters, ...scopeReplacements(scope) },
      ),
    ]);
    const total = intValue(totals[0]?.total);
    return {
      items: rows.map((row) => this.mapQualityRule(row)),
      meta: { page: page.page, limit: page.limit, total, totalPages: Math.max(1, Math.ceil(total / page.limit)) },
      summary: {
        total,
        critical: intValue(totals[0]?.critical),
        active: intValue(totals[0]?.active),
        pendingIssues: intValue(totals[0]?.pending_issues),
      },
    };
  }

  async getDataQualityRule(scope: PortalScope, ruleId: string) {
    const rows = await this.queryRows(
      `SELECT r._id, r.rule_code, r.rule_name, r.target_table, r.target_field, r.severity, r.expression_json,
              r.expected_action, r.build_phase, r.is_active, r._updated_at,
              COUNT(i._id) FILTER (WHERE ${pendingIssueSql('i')})::int AS open_issues
         FROM data_quality_rules r
         LEFT JOIN data_quality_issues i ON i.quality_rule_id = r._id AND ${tenantPredicate(scope, 'i')}
        WHERE r._id::text = :ruleId OR r.rule_code = :ruleId
        GROUP BY r._id
        LIMIT 1`,
      { ruleId: decodeURIComponent(ruleId), ...scopeReplacements(scope) },
    );
    if (!rows[0]) throw new NotFoundException('DATA_QUALITY_RULE_NOT_FOUND');
    return this.mapQualityRule(rows[0]);
  }

  private mapQualityRule(row: Row) {
    return {
      ruleId: id(row._id),
      ruleCode: clean(row.rule_code, `dq_rule_${id(row._id)}`),
      ruleName: clean(row.rule_name, 'Regla de calidad sin nombre'),
      description: `Control ${clean(row.severity, 'medium')} sobre ${clean(row.target_table)}${nullableText(row.target_field) ? `.${nullableText(row.target_field)}` : ''}`,
      targetTable: clean(row.target_table, 'unknown_table'),
      targetField: nullableText(row.target_field),
      ruleType: clean(row.build_phase, 'MVP'),
      // En mayúsculas, como las opciones del filtro: la siembra las guarda en minúscula y la tarjeta
      // «Críticas» comparaba contra 'CRITICAL', así que contaba siempre 0.
      severity: clean(row.severity, 'medium').toUpperCase(),
      status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE',
      // Eran constantes del servicio ('on_demand_and_release_gate', 'data-quality') presentadas como
      // datos de cada regla: la tabla no guarda frecuencia ni dueño. Se conservan los campos por
      // compatibilidad, vacíos, en vez de inventar un valor.
      frequency: null,
      owner: null,
      expectedAction: clean(row.expected_action, 'review_data_quality_issue'),
      checkConfig: jsonValue(row.expression_json),
      // `_updated_at` es cuándo cambió la DEFINICIÓN de la regla, no cuándo se evaluó. Se publica
      // con ese nombre y sin inventar un `lastRunStatus: 'completed'` que nadie había comprobado.
      definitionUpdatedAt: iso(row._updated_at),
      openIssues: intValue(row.open_issues),
    };
  }
}
