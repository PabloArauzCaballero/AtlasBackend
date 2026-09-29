/**
 * @file Servicio de aplicación: calcula el contenido de cada widget de un informe del portal.
 * @business Cada informe responde SU pregunta: gobierno de datos cuenta campos sensibles, cobertura cuenta endpoints.
 * @system consultas agregadas de sólo lectura sobre catálogos de plataforma y tablas acotadas por tenant.
 */
import { pendingIssueSql } from '../../../common/utils/data-quality-issue-status.util.js';
import { Sequelize } from 'sequelize-typescript';
import { clean, intValue, Row } from './portal-format.util.js';
import { PortalOperationsService } from './portal-operations.service.js';
import { PortalQueryBase } from './portal-query.base.js';
import { PortalScope, scopeReplacements, tenantPredicate } from './portal-scope.util.js';

/** Una línea del widget: una etiqueta legible y su valor. Es todo lo que el portal necesita pintar. */
export type ReportWidgetEntry = { label: string; value: number | string };

export type ReportWidgetData = {
  /** `metrics`: cifras sueltas; `breakdown`: un conteo por categoría; `rows`: filas de detalle. */
  kind: 'metrics' | 'breakdown' | 'rows';
  entries: ReportWidgetEntry[];
};

type Filters = Record<string, unknown>;

/**
 * Sólo las reglas de la versión VIGENTE: las reglas no se editan, se publica una versión nueva, así
 * que contar la tabla entera sumaría las de todas las versiones archivadas.
 */
const ACTIVE_RISK_RULES = `SELECT COUNT(*)::text AS count
   FROM risk_policy_rules r
   JOIN risk_ruleset_versions v ON v._id = r.ruleset_version_id
  WHERE v.status = 'active'`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

function textFilter(filters: Filters, key: string): string {
  const value = filters[key];
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function dateFilter(filters: Filters, key: string): string {
  const value = textFilter(filters, key);
  return ISO_DATE.test(value) ? value : '';
}

/**
 * Antes `runReport` devolvía para LOS CUATRO informes lo mismo: el semáforo de release, diez alertas
 * y diez corridas de job. «Gobierno y sensibilidad de datos» no contaba ni un campo sensible y
 * «Cobertura de endpoints» no miraba el catálogo de endpoints: el nombre del informe prometía una
 * cosa y el resultado era otra, y los filtros se devolvían tal cual sin aplicarse.
 *
 * Ahora cada `queryKey` declarado en `portal-report-definitions.ts` tiene aquí su cálculo, sobre las
 * tablas que el propio informe declara en `sourceReference`, y aplica los filtros que declara.
 * Un `queryKey` sin cálculo responde vacío y lo dice, en vez de rellenarse con datos de otro informe.
 */
export class PortalReportWidgets extends PortalQueryBase {
  constructor(
    sequelize: Sequelize,
    private readonly operations: PortalOperationsService,
  ) {
    super(sequelize);
  }

  compute(scope: PortalScope, queryKey: string, filters: Filters): Promise<ReportWidgetData> {
    switch (queryKey) {
      case 'opsCounts':
        return this.opsCounts(scope, filters);
      case 'openIssues':
        return this.openIssues(scope);
      case 'endpointsByRisk':
        return this.endpointBreakdown('risk_level', filters);
      case 'reviewStatus':
        return this.endpointBreakdown('review_status', filters);
      case 'sensitiveFields':
        return this.sensitiveFields(filters);
      case 'qualityRisk':
        return this.qualityRisk(scope, filters);
      default:
        return Promise.resolve({ kind: 'metrics', entries: [] });
    }
  }

  private async opsCounts(scope: PortalScope, filters: Filters): Promise<ReportWidgetData> {
    const from = dateFilter(filters, 'from');
    const to = dateFilter(filters, 'to');
    const window = [
      from ? `COALESCE(j.started_at, j._created_at) >= CAST(:from AS timestamptz)` : 'TRUE',
      to ? `COALESCE(j.started_at, j._created_at) < CAST(:to AS timestamptz) + INTERVAL '1 day'` : 'TRUE',
    ].join(' AND ');
    const [endpoints, tables, rules, issues, jobs] = await Promise.all([
      this.count('system_endpoint_catalog'),
      this.count('system_data_entity_catalog'),
      this.count('data_quality_rules', 'is_active = true'),
      this.countInScope(scope, 'data_quality_issues', 'i', pendingIssueSql('i')),
      this.queryRows<{ total: string; failed: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE UPPER(COALESCE(j.status, '')) = 'FAILED')::text AS failed
           FROM system_job_runs j
          WHERE ${tenantPredicate(scope, 'j')} AND ${window}`,
        { ...scopeReplacements(scope), from, to },
      ),
    ]);
    return {
      kind: 'metrics',
      entries: [
        { label: 'Endpoints catalogados', value: endpoints },
        { label: 'Tablas documentadas', value: tables },
        { label: 'Reglas de calidad activas', value: rules },
        { label: 'Incidencias de calidad pendientes', value: issues },
        { label: 'Corridas de procesos automáticos', value: intValue(jobs[0]?.total) },
        { label: 'Corridas fallidas', value: intValue(jobs[0]?.failed) },
      ],
    };
  }

  private async openIssues(scope: PortalScope): Promise<ReportWidgetData> {
    const alerts = await this.operations.listAlerts(scope, { page: 1, limit: 10, status: 'OPEN' });
    return {
      kind: 'rows',
      entries: alerts.items.map((alert) => ({ label: alert.title, value: alert.severity })),
    };
  }

  private async endpointBreakdown(column: 'risk_level' | 'review_status', filters: Filters): Promise<ReportWidgetData> {
    const module = textFilter(filters, 'module');
    const rows = await this.queryRows<{ label: string; count: string }>(
      `SELECT COALESCE(NULLIF(TRIM(${column}::text), ''), 'sin dato') AS label, COUNT(*)::text AS count
         FROM system_endpoint_catalog
        WHERE (:module = '' OR module ILIKE :module)
        GROUP BY 1
        ORDER BY 2 DESC, 1`,
      { module },
    );
    return { kind: 'breakdown', entries: rows.map((row) => ({ label: clean(row.label), value: intValue(row.count) })) };
  }

  private async sensitiveFields(filters: Filters): Promise<ReportWidgetData> {
    const classification = textFilter(filters, 'classification');
    const [byClass, purposes, retention] = await Promise.all([
      this.queryRows<{ label: string; count: string }>(
        `SELECT classification_code AS label, COUNT(*)::text AS count
           FROM sensitive_field_rules
          WHERE is_active = true AND (:classification = '' OR classification_code = :classification)
          GROUP BY 1
          ORDER BY 2 DESC, 1`,
        { classification },
      ),
      this.count('privacy_processing_purposes', 'is_active = true'),
      this.count('retention_policies', 'is_active = true'),
    ]);
    const entries: ReportWidgetEntry[] = byClass.map((row) => ({
      label: `Campos ${clean(row.label)}`,
      value: intValue(row.count),
    }));
    entries.push(
      { label: 'Finalidades de tratamiento activas', value: purposes },
      { label: 'Políticas de retención activas', value: retention },
    );
    return { kind: 'breakdown', entries };
  }

  private async qualityRisk(scope: PortalScope, filters: Filters): Promise<ReportWidgetData> {
    const severity = textFilter(filters, 'severity').toLowerCase();
    const bySeverity = severity ? `LOWER(COALESCE(r.severity, '')) = :severity` : 'TRUE';
    const [rules, issues, policyRules, hardStops] = await Promise.all([
      this.queryRows<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM data_quality_rules r WHERE r.is_active = true AND ${bySeverity}`,
        { severity },
      ),
      this.queryRows<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM data_quality_issues i
           LEFT JOIN data_quality_rules r ON r._id = i.quality_rule_id
          WHERE ${tenantPredicate(scope, 'i')}
            AND ${pendingIssueSql('i')}
            AND ${bySeverity}`,
        { ...scopeReplacements(scope), severity },
      ),
      this.queryRows<{ count: string }>(`${ACTIVE_RISK_RULES} AND ${bySeverity}`, { severity }),
      this.queryRows<{ count: string }>(`${ACTIVE_RISK_RULES} AND r.is_hard_stop = true AND ${bySeverity}`, { severity }),
    ]);
    const value = (rows: Row[]) => intValue(rows[0]?.count);
    return {
      kind: 'metrics',
      entries: [
        { label: 'Reglas de calidad activas', value: value(rules) },
        { label: 'Incidencias de calidad pendientes', value: value(issues) },
        { label: 'Reglas de la política de riesgo', value: value(policyRules) },
        { label: 'Reglas que frenan la solicitud', value: value(hardStops) },
      ],
    };
  }
}
