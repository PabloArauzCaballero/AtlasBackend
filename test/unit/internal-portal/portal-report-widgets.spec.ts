import { describe, expect, it, jest } from '@jest/globals';
import { PortalOperationsService } from '../../../src/modules/internal-portal/application/portal-operations.service.js';
import { PortalReportsService } from '../../../src/modules/internal-portal/application/portal-reports.service.js';
import { reportDefinitions } from '../../../src/modules/internal-portal/application/portal-report-definitions.js';
import { INTERNAL_PERMISSION_SEEDS } from '../../../src/modules/internal-users/internal-rbac.permissions.js';
import type { PortalScope } from '../../../src/modules/internal-portal/application/portal-scope.util.js';

/**
 * Los cuatro informes del portal devolvían lo mismo (semáforo de release, alertas y jobs) y
 * devolvían los filtros sin aplicarlos. Estas pruebas fijan que cada informe consulta SUS tablas,
 * aplica SUS filtros y declara permisos que existen en el catálogo RBAC.
 */
type Captured = { sql: string; replacements: Record<string, unknown> };

function build(respond: (sql: string) => Record<string, unknown>[] = () => [{ count: '0' }]) {
  const captured: Captured[] = [];
  const sequelize = {
    query: jest.fn(async (sql: string, options: { replacements?: Record<string, unknown> }) => {
      captured.push({ sql, replacements: options.replacements ?? {} });
      return respond(sql);
    }),
  };
  const operations = new PortalOperationsService(sequelize as never);
  return { service: new PortalReportsService(sequelize as never, operations), captured };
}

const tenant: PortalScope = { tenantId: '7', allTenants: false };

describe('PortalReportsService.runReport — cada informe responde su pregunta', () => {
  it('gobierno de datos cuenta campos sensibles por clasificación y aplica el filtro', async () => {
    const { service, captured } = build((sql) => (sql.includes('GROUP BY') ? [{ label: 'PII_DIRECTA', count: '4' }] : [{ count: '3' }]));
    const result = await service.runReport(tenant, 'data-governance', { filters: { classification: 'PII_DIRECTA', ajeno: 'x' } });

    const grouped = captured.find((query) => query.sql.includes('FROM sensitive_field_rules'));
    expect(grouped?.replacements.classification).toBe('PII_DIRECTA');
    expect(captured.some((query) => query.sql.includes('system_job_runs'))).toBe(false);
    expect(result.appliedFilters).toEqual({ classification: 'PII_DIRECTA' });
    expect(result.widgets[0].data).toEqual({
      kind: 'breakdown',
      entries: [
        { label: 'Campos PII_DIRECTA', value: 4 },
        { label: 'Finalidades de tratamiento activas', value: 3 },
        { label: 'Políticas de retención activas', value: 3 },
      ],
    });
  });

  it('cobertura de endpoints agrupa el catálogo de endpoints por riesgo y por revisión, filtrando módulo', async () => {
    const { service, captured } = build(() => [{ label: 'high', count: '2' }]);
    const result = await service.runReport(tenant, 'endpoint-coverage', { filters: { module: 'loans' } });

    const endpointQueries = captured.filter((query) => query.sql.includes('FROM system_endpoint_catalog'));
    expect(endpointQueries.map((query) => query.sql.match(/COALESCE\(NULLIF\(TRIM\((\w+)/)?.[1])).toEqual(['risk_level', 'review_status']);
    expect(endpointQueries.every((query) => query.replacements.module === 'loans')).toBe(true);
    expect(result.widgets.map((widget) => widget.data.kind)).toEqual(['breakdown', 'breakdown']);
  });

  it('el resumen operacional acota las corridas al tenant y a la ventana de fechas', async () => {
    const { service, captured } = build((sql) => (sql.includes('failed') ? [{ total: '10', failed: '2' }] : [{ count: '1' }]));
    const result = await service.runReport(tenant, 'operations-overview', { filters: { from: '2026-09-01', to: 'no-es-fecha' } });

    const jobs = captured.find((query) => query.sql.includes('FROM system_job_runs j'));
    expect(jobs?.sql).toContain('j._tenant_id = CAST(:scopeTenantId AS BIGINT)');
    expect(jobs?.sql).toContain(':from');
    expect(jobs?.sql).not.toContain(':to AS');
    expect(result.widgets[0].data.entries).toContainEqual({ label: 'Corridas fallidas', value: 2 });
  });

  it('calidad de riesgo sólo cuenta las reglas de la versión vigente y filtra severidad', async () => {
    const { service, captured } = build(() => [{ count: '5' }]);
    await service.runReport(tenant, 'risk-quality', { filters: { severity: 'HIGH' } });

    const riskRules = captured.filter((query) => query.sql.includes('FROM risk_policy_rules'));
    expect(riskRules).toHaveLength(2);
    expect(riskRules.every((query) => query.sql.includes("v.status = 'active'"))).toBe(true);
    expect(riskRules.every((query) => query.replacements.severity === 'high')).toBe(true);
  });

  it('no publica un executionId ni finge persistencia', async () => {
    const { service } = build();
    const result = await service.runReport(tenant, 'operations-overview', {});
    expect(result).not.toHaveProperty('executionId');
    expect(result.persisted).toBe(false);
  });
});

describe('definiciones de informes', () => {
  const catalog = new Set(INTERNAL_PERMISSION_SEEDS.map((permission) => permission.code));

  it('cada permiso declarado existe en el catálogo RBAC interno', () => {
    for (const report of reportDefinitions()) {
      for (const code of (report.permissions.required as string[]) ?? []) {
        expect(catalog.has(code)).toBe(true);
      }
    }
  });

  it('allowedFilters y filters declaran las mismas claves', () => {
    for (const report of reportDefinitions()) {
      expect(Object.keys(report.allowedFilters).sort()).toEqual(report.filters.map((filter) => String(filter.key)).sort());
    }
  });
});

describe('PortalOperationsService — filtros de corridas y alertas', () => {
  it('listJobs aplica estado y origen, y resume por estado sobre TODO el filtro', async () => {
    const captured: Captured[] = [];
    const sequelize = {
      query: jest.fn(async (sql: string, options: { replacements?: Record<string, unknown> }) => {
        captured.push({ sql, replacements: options.replacements ?? {} });
        if (sql.includes('GROUP BY'))
          return [
            { status: 'FAILED', count: '3' },
            { status: 'COMPLETED', count: '40' },
          ];
        if (sql.includes('COUNT(*)')) return [{ count: '43' }];
        return [];
      }),
    };
    const service = new PortalOperationsService(sequelize as never);
    const result = await service.listJobs(tenant, { page: 1, limit: 20, status: 'failed', queue: 'scheduler' });

    for (const query of captured) {
      expect(query.sql).toContain('UPPER(:status)');
      expect(query.replacements).toMatchObject({ status: 'failed', queue: 'scheduler' });
    }
    expect(result.summary.byStatus).toEqual({ FAILED: 3, COMPLETED: 40 });
  });

  it('listAlerts aplica estado y severidad en la página y en el total', async () => {
    const captured: Captured[] = [];
    const sequelize = {
      query: jest.fn(async (sql: string, options: { replacements?: Record<string, unknown> }) => {
        captured.push({ sql, replacements: options.replacements ?? {} });
        return sql.includes('COUNT(*)') ? [{ count: '0' }] : [];
      }),
    };
    const service = new PortalOperationsService(sequelize as never);
    await service.listAlerts(tenant, { page: 1, limit: 20, status: 'OPEN', severity: 'high' });

    expect(captured).toHaveLength(2);
    for (const query of captured) {
      expect(query.sql).toContain('UPPER(:severity)');
      expect(query.replacements).toMatchObject({ status: 'OPEN', severity: 'high' });
    }
  });
});
