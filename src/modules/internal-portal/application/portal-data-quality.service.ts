/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { NotFoundException } from '@nestjs/common';
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
export class PortalDataQualityService extends PortalQueryBase {
  async listDataQualityRules(scope: PortalScope, query: Query) {
    const page = parsePage(query);
    const q = clean(query.q, '');
    const rows = await this.queryRows(
      `SELECT r._id, r.rule_code, r.rule_name, r.target_table, r.target_field, r.severity, r.expression_json,
              r.expected_action, r.build_phase, r.is_active, r._updated_at,
              COUNT(i._id) FILTER (
                WHERE COALESCE(i.issue_status, 'open') NOT IN ('resolved','closed','acknowledged')
              )::int AS open_issues
         FROM data_quality_rules r
         LEFT JOIN data_quality_issues i ON i.quality_rule_id = r._id AND ${tenantPredicate(scope, 'i')}
        WHERE (:q = '' OR r.rule_code ILIKE :like OR r.rule_name ILIKE :like OR r.target_table ILIKE :like OR COALESCE(r.target_field,'') ILIKE :like)
        GROUP BY r._id
        ORDER BY r.severity DESC NULLS LAST, r.rule_code ASC
        LIMIT :limit OFFSET :offset`,
      { q, like: `%${q}%`, limit: page.limit, offset: page.offset, ...scopeReplacements(scope) },
    );
    const total = await this.queryRows<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM data_quality_rules WHERE (:q = '' OR rule_code ILIKE :like OR rule_name ILIKE :like OR target_table ILIKE :like OR COALESCE(target_field,'') ILIKE :like)`,
      { q, like: `%${q}%` },
    );
    const items = rows.map((row) => this.mapQualityRule(row));
    return {
      items,
      meta: {
        page: page.page,
        limit: page.limit,
        total: intValue(total[0]?.count),
        totalPages: Math.max(1, Math.ceil(intValue(total[0]?.count) / page.limit)),
      },
    };
  }

  async getDataQualityRule(scope: PortalScope, ruleId: string) {
    const rows = await this.queryRows(
      `SELECT r._id, r.rule_code, r.rule_name, r.target_table, r.target_field, r.severity, r.expression_json,
              r.expected_action, r.build_phase, r.is_active, r._updated_at,
              COUNT(i._id) FILTER (
                WHERE COALESCE(i.issue_status, 'open') NOT IN ('resolved','closed','acknowledged')
              )::int AS open_issues
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
      severity: clean(row.severity, 'medium'),
      status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE',
      frequency: 'on_demand_and_release_gate',
      owner: 'data-quality',
      expectedAction: clean(row.expected_action, 'review_data_quality_issue'),
      checkConfig: jsonValue(row.expression_json),
      // `_updated_at` es cuándo cambió la DEFINICIÓN de la regla, no cuándo se evaluó. Se publica
      // con ese nombre y sin inventar un `lastRunStatus: 'completed'` que nadie había comprobado.
      definitionUpdatedAt: iso(row._updated_at),
      openIssues: intValue(row.open_issues),
    };
  }
}
