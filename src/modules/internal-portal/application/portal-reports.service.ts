/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { clean, containsQuery, paginate, Query, Row } from './portal-format.util.js';
import { reportDefinitions } from './portal-report-definitions.js';
import { PortalOperationsService } from './portal-operations.service.js';
import { PortalQueryBase } from './portal-query.base.js';
import { PortalReportWidgets } from './portal-report-widgets.js';
import { PortalScope } from './portal-scope.util.js';

/**
 * Reportes, exports y release readiness del portal interno.
 *
 * Extraído de `internal-portal.service.ts` (Fase 2.2 del plan 10/10) sin cambios de comportamiento.
 * Depende de `PortalOperationsService` porque `runReport` compone alertas y jobs junto al readiness —
 * esa dependencia era implícita cuando todo vivía en la misma clase de 1341 líneas; ahora es explícita.
 */
export class PortalReportsService extends PortalQueryBase {
  private readonly widgets: PortalReportWidgets;

  constructor(sequelize: Sequelize, operations: PortalOperationsService) {
    super(sequelize);
    this.widgets = new PortalReportWidgets(sequelize, operations);
  }

  /**
   * Catálogos EXPORTABLES disponibles, no exports ya ejecutados.
   *
   * Antes cada entrada venía con `status: 'READY'`, `requestedBy: 'seed_admin'` y un `requestedAt`
   * igual a la constante `NOW_SEED`: describía una ejecución que nunca ocurrió y un solicitante que
   * no existe. No hay tabla de exports en el modelo, así que lo honesto es publicar lo que esto es
   * de verdad — un descriptor de dónde descargar cada catálogo y cuántas filas tiene ahora mismo.
   */
  async listExports(query: Query) {
    const [endpoints, tables, rules] = await Promise.all([
      this.count('system_endpoint_catalog'),
      this.count('system_data_entity_catalog'),
      this.count('data_quality_rules'),
    ]);
    const items = [
      {
        exportId: 'export-endpoint-catalog',
        name: 'Catálogo de endpoints',
        resourceType: 'system_endpoint_catalog',
        resourceId: null,
        format: 'JSON',
        downloadUrl: '/api/v1/systems/endpoints',
        metadata: { rows: endpoints, reason: 'QA y revisión técnica' },
      },
      {
        exportId: 'export-data-catalog',
        name: 'Catálogo de datos',
        resourceType: 'system_data_entity_catalog',
        resourceId: null,
        format: 'JSON',
        downloadUrl: '/api/v1/systems/data-entities',
        metadata: { rows: tables, reason: 'Gobierno de datos' },
      },
      {
        exportId: 'export-data-quality',
        name: 'Reglas de calidad',
        resourceType: 'data_quality_rules',
        resourceId: null,
        format: 'JSON',
        downloadUrl: '/api/v1/internal/data-quality/rules',
        metadata: { rows: rules, reason: 'Auditoría de calidad' },
      },
    ];
    return paginate(
      items.filter((item) => containsQuery(item, clean(query.q, '').toLowerCase())),
      query,
    );
  }

  async getExport(exportId: string) {
    const result = await this.listExports({ page: 1, limit: 50 });
    const item = result.items.find((row) => row.exportId === decodeURIComponent(exportId));
    if (!item) throw new NotFoundException('DATA_EXPORT_NOT_FOUND');
    return {
      ...item,
      reason: clean(item.metadata?.reason, 'Export operativo controlado'),
      policySnapshot: { masking: 'no_raw_pii', audit: true },
    };
  }

  /**
   * `data_quality_issues` y `system_job_runs` llevan `_tenant_id`: sin acotarlas, el semáforo de
   * release de un tenant se ponía en ámbar por los incidentes de otro (ATLAS-SEC-009). El resto son
   * catálogos de plataforma y se cuentan enteros a propósito.
   */
  async getReleaseReadiness(scope: PortalScope) {
    const [endpoints, entities, suites, rules, issues, jobs] = await Promise.all([
      this.count('system_endpoint_catalog'),
      this.count('system_data_entity_catalog'),
      this.count('system_test_suites'),
      this.count('data_quality_rules'),
      this.countInScope(scope, 'data_quality_issues', 'i', `COALESCE(i.issue_status, 'open') NOT IN ('resolved','closed','acknowledged')`),
      this.countInScope(scope, 'system_job_runs', 'j'),
    ]);
    const checks = [
      {
        key: 'endpoint_catalog',
        label: 'Catálogo de endpoints poblado',
        status: endpoints > 0 ? 'ok' : 'blocked',
        detail: `${endpoints} endpoints catalogados`,
        details: { endpoints },
      },
      {
        key: 'data_catalog',
        label: 'Catálogo de datos poblado',
        status: entities > 0 ? 'ok' : 'blocked',
        detail: `${entities} tablas documentadas`,
        details: { entities },
      },
      {
        key: 'qa_suites',
        label: 'Suites QA disponibles',
        status: suites > 0 ? 'ok' : 'warning',
        detail: `${suites} suites`,
        details: { suites },
      },
      {
        key: 'data_quality_rules',
        label: 'Reglas de calidad activas',
        status: rules > 0 ? 'ok' : 'warning',
        detail: `${rules} reglas`,
        details: { rules },
      },
      {
        key: 'open_quality_issues',
        label: 'Issues de calidad abiertos',
        status: issues === 0 ? 'ok' : 'warning',
        detail: `${issues} issues abiertos`,
        details: { issues },
      },
      {
        key: 'runtime_jobs',
        label: 'Jobs operativos con evidencia',
        status: jobs > 0 ? 'ok' : 'warning',
        detail: `${jobs} ejecuciones registradas`,
        details: { jobs },
      },
    ] as Array<{ key: string; label: string; status: 'ok' | 'warning' | 'blocked'; detail: string; details: Row }>;
    return {
      status: checks.some((check) => check.status === 'blocked')
        ? 'blocked'
        : checks.some((check) => check.status === 'warning')
          ? 'warning'
          : 'ready',
      checks,
      blockers: checks.filter((check) => check.status === 'blocked'),
      warnings: checks.filter((check) => check.status === 'warning'),
      generatedAt: new Date().toISOString(),
    };
  }

  listReports(query: Query) {
    const q = clean(query.q, '').toLowerCase();
    const items = reportDefinitions()
      .filter((item) => containsQuery(item, q))
      .map(({ widgets: _widgets, filters: _filters, ...item }) => item);
    return paginate(items, query);
  }

  getReport(reportId: string) {
    const report = reportDefinitions().find(
      (item) => item.reportId === decodeURIComponent(reportId) || item.key === decodeURIComponent(reportId),
    );
    if (!report) throw new NotFoundException('REPORT_NOT_FOUND');
    return report;
  }

  /**
   * Computa el reporte EN VIVO sobre los datos del alcance del actor. No persiste nada, y por eso
   * no devuelve un `executionId`: `computedAt` dice exactamente lo que es.
   *
   * Cada widget se calcula con SU consulta (`PortalReportWidgets`). Antes los cuatro informes
   * devolvían lo mismo —semáforo de release, alertas y jobs— y los filtros se devolvían sin aplicar.
   */
  async runReport(scope: PortalScope, reportId: string, body: Row) {
    const report = this.getReport(reportId);
    const allowed = new Set(report.filters.map((filter) => String(filter.key)));
    const requested = (body.filters ?? {}) as Row;
    // Sólo los filtros que el informe declara: el resto se ignoraba igual, pero ahora no se devuelve
    // como si se hubiera aplicado.
    const filters = Object.fromEntries(Object.entries(requested).filter(([key]) => allowed.has(key)));
    const widgets = await Promise.all(
      report.widgets.map(async (widget) => ({
        widgetId: clean(widget.widgetId),
        title: clean(widget.title),
        data: await this.widgets.compute(scope, clean(widget.queryKey, ''), filters),
      })),
    );
    return {
      reportId: report.reportId,
      computedAt: new Date().toISOString(),
      persisted: false,
      appliedFilters: filters,
      widgets,
    };
  }
}
