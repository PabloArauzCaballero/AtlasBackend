import { NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { clean, containsQuery, paginate, Query, Row } from './portal-format.util.js';
import { NOW_SEED, reportDefinitions } from './portal-report-definitions.js';
import { PortalOperationsService } from './portal-operations.service.js';
import { PortalQueryBase } from './portal-query.base.js';

/**
 * Reportes, exports y release readiness del portal interno.
 *
 * Extraído de `internal-portal.service.ts` (Fase 2.2 del plan 10/10) sin cambios de comportamiento.
 * Depende de `PortalOperationsService` porque `runReport` compone alertas y jobs junto al readiness —
 * esa dependencia era implícita cuando todo vivía en la misma clase de 1341 líneas; ahora es explícita.
 */
export class PortalReportsService extends PortalQueryBase {
  constructor(
    sequelize: Sequelize,
    private readonly operations: PortalOperationsService,
  ) {
    super(sequelize);
  }

  async listExports(query: Query) {
    const [endpoints, tables, rules] = await Promise.all([
      this.count('system_endpoint_catalog'),
      this.count('system_data_entity_catalog'),
      this.count('data_quality_rules'),
    ]);
    const requestedAt = NOW_SEED;
    const items = [
      {
        exportId: 'export-endpoint-catalog',
        name: 'Catálogo de endpoints',
        resourceType: 'system_endpoint_catalog',
        resourceId: null,
        format: 'JSON',
        status: 'READY',
        requestedBy: 'seed_admin',
        requestedAt,
        finishedAt: requestedAt,
        expiresAt: null,
        downloadUrl: '/api/v1/systems/endpoints',
        metadata: { rows: endpoints, reason: 'QA y revisión técnica' },
      },
      {
        exportId: 'export-data-catalog',
        name: 'Catálogo de datos',
        resourceType: 'system_data_entity_catalog',
        resourceId: null,
        format: 'JSON',
        status: 'READY',
        requestedBy: 'seed_admin',
        requestedAt,
        finishedAt: requestedAt,
        expiresAt: null,
        downloadUrl: '/api/v1/systems/data-entities',
        metadata: { rows: tables, reason: 'Gobierno de datos' },
      },
      {
        exportId: 'export-data-quality',
        name: 'Reglas de calidad',
        resourceType: 'data_quality_rules',
        resourceId: null,
        format: 'JSON',
        status: 'READY',
        requestedBy: 'seed_admin',
        requestedAt,
        finishedAt: requestedAt,
        expiresAt: null,
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
      filters: {},
      policySnapshot: { masking: 'no_raw_pii', audit: true },
      auditRequestId: `audit:${item.exportId}`,
      errorCode: null,
      errorMessage: null,
    };
  }

  async getReleaseReadiness() {
    const [endpoints, entities, suites, rules, issues, jobs] = await Promise.all([
      this.count('system_endpoint_catalog'),
      this.count('system_data_entity_catalog'),
      this.count('system_test_suites'),
      this.count('data_quality_rules'),
      this.count('data_quality_issues', `COALESCE(issue_status, 'open') NOT IN ('resolved','closed','acknowledged')`),
      this.count('system_job_runs'),
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

  async runReport(reportId: string, body: Row) {
    const report = this.getReport(reportId);
    const [readiness, alerts, jobs] = await Promise.all([
      this.getReleaseReadiness(),
      this.operations.listAlerts({ page: 1, limit: 10 }),
      this.operations.listJobs({ page: 1, limit: 10 }),
    ]);
    return {
      reportId: report.reportId,
      executionId: `report-run-${report.reportId}-${Date.now()}`,
      status: 'completed',
      generatedAt: new Date().toISOString(),
      data: { filters: body.filters ?? body, readiness, alerts: alerts.items, jobs: jobs.items },
      widgets: report.widgets.map((widget) => ({
        widgetId: clean(widget.widgetId),
        title: clean(widget.title),
        data: { readinessStatus: readiness.status, alertCount: alerts.meta.total, jobCount: jobs.meta.total },
      })),
    };
  }

  listReportSnapshots(reportId: string, query: Query) {
    const report = this.getReport(reportId);
    const snapshots = [
      {
        snapshotId: `snapshot:${report.reportId}:seed`,
        reportId: report.reportId,
        status: 'READY',
        generatedAt: NOW_SEED,
        generatedBy: 'atlas_seed',
        summary: { source: report.sourceReference, criticality: report.criticality },
      },
      {
        snapshotId: `snapshot:${report.reportId}:current`,
        reportId: report.reportId,
        status: 'READY',
        generatedAt: new Date().toISOString(),
        generatedBy: 'internal_portal',
        summary: { source: 'live_backend', status: report.status },
      },
    ];
    return paginate(snapshots, query);
  }
}
