import { boolValue, clean, containsQuery, id, Query } from './portal-format.util.js';
import { reportDefinitions } from './portal-report-definitions.js';
import { PortalQueryBase } from './portal-query.base.js';

/**
 * Búsqueda transversal del portal interno (endpoints, tablas, reglas de calidad y reportes).
 *
 * Extraído de `internal-portal.service.ts` (Fase 2.2 del plan 10/10) sin cambios de comportamiento.
 */
export class PortalSearchService extends PortalQueryBase {
  async search(query: Query) {
    const q = clean(query.q, '').trim();
    if (!q) return { items: [], totals: {} };
    const [endpoints, entities, rules, reports] = await Promise.all([
      this.queryRows(
        `SELECT _id, method, full_path, route_name, module, status, risk_level, contains_pii FROM system_endpoint_catalog WHERE full_path ILIKE :like OR route_name ILIKE :like OR module ILIKE :like ORDER BY full_path ASC LIMIT 15`,
        { like: `%${q}%` },
      ),
      this.queryRows(
        `SELECT _id, table_name, entity_name, module, status, contains_pii FROM system_data_entity_catalog WHERE table_name ILIKE :like OR entity_name ILIKE :like OR module ILIKE :like ORDER BY table_name ASC LIMIT 15`,
        { like: `%${q}%` },
      ),
      this.queryRows(
        `SELECT _id, rule_code, rule_name, severity, is_active FROM data_quality_rules WHERE rule_code ILIKE :like OR rule_name ILIKE :like OR target_table ILIKE :like ORDER BY rule_code ASC LIMIT 15`,
        { like: `%${q}%` },
      ),
      Promise.resolve(
        reportDefinitions()
          .filter((report) => containsQuery(report, q.toLowerCase()))
          .slice(0, 15),
      ),
    ]);
    const items = [
      ...endpoints.map((row) => ({
        id: `endpoint:${id(row._id)}`,
        kind: 'endpoint',
        title: `${clean(row.method)} ${clean(row.full_path)}`,
        subtitle: clean(row.route_name, clean(row.module)),
        href: `/internal/systems/endpoints/${id(row._id)}`,
        status: clean(row.status),
        method: clean(row.method),
        riskLevel: clean(row.risk_level),
        containsPii: boolValue(row.contains_pii),
      })),
      ...entities.map((row) => ({
        id: `table:${id(row._id)}`,
        kind: 'table',
        title: clean(row.entity_name, clean(row.table_name)),
        subtitle: clean(row.table_name),
        href: `/internal/data-catalog/tables/${id(row._id)}`,
        status: clean(row.status),
        containsPii: boolValue(row.contains_pii),
      })),
      ...rules.map((row) => ({
        id: `quality:${id(row._id)}`,
        kind: 'quality_rule',
        title: clean(row.rule_name),
        subtitle: clean(row.rule_code),
        href: `/internal/data-quality/rules/${id(row._id)}`,
        status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE',
        riskLevel: clean(row.severity).toUpperCase(),
        containsPii: false,
      })),
      ...reports.map((report) => ({
        id: `report:${report.reportId}`,
        kind: 'report',
        title: report.name,
        subtitle: report.description,
        href: `/internal/reports/${report.reportId}`,
        status: report.status,
        riskLevel: report.criticality,
        containsPii: false,
      })),
    ];
    return { items, totals: { endpoints: endpoints.length, tables: entities.length, qualityRules: rules.length, reports: reports.length } };
  }
}
