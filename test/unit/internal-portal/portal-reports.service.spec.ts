import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { PortalReportsService } from '../../../src/modules/internal-portal/application/portal-reports.service.js';
import type { PortalOperationsService } from '../../../src/modules/internal-portal/application/portal-operations.service.js';
import type { PortalScope } from '../../../src/modules/internal-portal/application/portal-scope.util.js';

/**
 * Reportes, exports y semáforo de release del portal interno.
 *
 * Dos cosas se fijan aquí. La primera es ATLAS-SEC-009: de las seis cuentas del semáforo, sólo dos
 * —incidentes de calidad y corridas de job— llevan `_tenant_id`, y sin acotarlas el semáforo de un
 * tenant se ponía en ámbar por los incidentes de OTRO. Las otras cuatro son catálogo de plataforma y
 * se cuentan enteras a propósito; que el filtro aparezca donde no toca es tan defecto como que falte
 * donde sí. La segunda es que estas respuestas digan la verdad sobre sí mismas: los exports son
 * catálogos DESCARGABLES y no ejecuciones pasadas —antes venían con un `status: READY` y un
 * solicitante `seed_admin` que describían una ejecución que nunca ocurrió— y `runReport` computa en
 * vivo sin persistir, y por eso se declara `persisted: false` y no devuelve un `executionId` que
 * sugiera algo recuperable.
 */
const ALCANCE_TENANT: PortalScope = { tenantId: 't1', allTenants: false };
const ALCANCE_PLATAFORMA: PortalScope = { tenantId: 't1', allTenants: true };

describe('PortalReportsService', () => {
  let query: jest.Mock;
  let operations: PortalOperationsService;
  let service: PortalReportsService;
  let cuentas: Record<string, number>;

  beforeEach(() => {
    cuentas = {
      system_endpoint_catalog: 120,
      system_data_entity_catalog: 300,
      system_test_suites: 4,
      data_quality_rules: 12,
      data_quality_issues: 0,
      system_job_runs: 7,
    };
    query = jest.fn(async (sql: string) => {
      const tabla = Object.keys(cuentas).find((nombre) => sql.includes(nombre));
      return [{ count: String(cuentas[tabla ?? ''] ?? 0) }];
    }) as unknown as jest.Mock;
    operations = {
      listAlerts: jest.fn(async () => ({ items: [{ alertId: 'a1' }], meta: { total: 1 } })),
      listJobs: jest.fn(async () => ({ items: [{ jobRunId: 'j1' }], meta: { total: 3 } })),
    } as unknown as PortalOperationsService;
    service = new PortalReportsService({ query } as unknown as Sequelize, operations);
  });

  /** El SQL de la última consulta que menciona la tabla indicada. */
  function sqlDe(tabla: string): string {
    const sqls = query.mock.calls.map((llamada) => llamada[0] as string).filter((sql) => sql.includes(tabla));
    return sqls.at(-1) ?? '';
  }

  describe('exports', () => {
    it('publica catálogos descargables con sus filas de ahora, no ejecuciones inventadas', async () => {
      const resultado = await service.listExports({ page: 1, limit: 50 });

      expect(resultado.items.map((item) => item.exportId)).toEqual([
        'export-endpoint-catalog',
        'export-data-catalog',
        'export-data-quality',
      ]);
      expect(resultado.items[0].metadata.rows).toBe(120);
      expect(resultado.items[0]).not.toHaveProperty('status');
      expect(resultado.items[0]).not.toHaveProperty('requestedBy');
    });

    it('el buscador filtra el catálogo en memoria', async () => {
      const resultado = await service.listExports({ page: 1, limit: 50, q: 'calidad' });

      expect(resultado.items.map((item) => item.exportId)).toEqual(['export-data-quality']);
    });

    it('un export concreto añade su motivo y la política con la que se sirve', async () => {
      const item = await service.getExport('export-data-catalog');

      expect(item.exportId).toBe('export-data-catalog');
      expect(item.reason).toBe('Gobierno de datos');
      expect(item.policySnapshot).toEqual({ masking: 'no_raw_pii', audit: true });
    });

    it('acepta el identificador codificado en la URL', async () => {
      await expect(service.getExport(encodeURIComponent('export-data-quality'))).resolves.toHaveProperty('exportId', 'export-data-quality');
    });

    it('un export que no existe es 404 con el código del dominio', async () => {
      await expect(service.getExport('export-inventado')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('semáforo de release', () => {
    it('acota por tenant las DOS tablas que llevan `_tenant_id` y sólo esas', async () => {
      await service.getReleaseReadiness(ALCANCE_TENANT);

      expect(sqlDe('data_quality_issues')).toContain('_tenant_id = CAST(:scopeTenantId AS BIGINT)');
      expect(sqlDe('system_job_runs')).toContain('_tenant_id = CAST(:scopeTenantId AS BIGINT)');
      for (const catalogo of ['system_endpoint_catalog', 'system_data_entity_catalog', 'system_test_suites', 'data_quality_rules']) {
        expect(sqlDe(catalogo)).not.toContain('_tenant_id');
      }
    });

    it('el tenant viaja por parámetro y no interpolado en el SQL', async () => {
      await service.getReleaseReadiness(ALCANCE_TENANT);

      const llamada = query.mock.calls.filter((entrada) => String(entrada[0]).includes('data_quality_issues')).at(-1) as unknown as [
        string,
        { replacements: Record<string, unknown> },
      ];
      expect(llamada[1].replacements).toMatchObject({ scopeTenantId: 't1' });
      expect(llamada[0]).not.toContain("'t1'");
    });

    it('un actor de plataforma cuenta sobre todos los tenants, sin predicado de contención', async () => {
      await service.getReleaseReadiness(ALCANCE_PLATAFORMA);

      expect(sqlDe('data_quality_issues')).not.toContain('_tenant_id = CAST(:scopeTenantId AS BIGINT)');
    });

    it('sólo cuenta como incidente lo que sigue abierto', async () => {
      await service.getReleaseReadiness(ALCANCE_TENANT);

      expect(sqlDe('data_quality_issues')).toContain("NOT IN ('resolved','closed','acknowledged')");
    });

    it('con todo poblado y sin incidentes, el semáforo está en verde y sin avisos', async () => {
      const readiness = await service.getReleaseReadiness(ALCANCE_TENANT);

      expect(readiness.status).toBe('ready');
      expect(readiness.blockers).toEqual([]);
      expect(readiness.warnings).toEqual([]);
      expect(readiness.checks).toHaveLength(6);
    });

    it('un catálogo vacío BLOQUEA; un incidente abierto sólo avisa', async () => {
      cuentas.system_endpoint_catalog = 0;
      cuentas.data_quality_issues = 2;

      const readiness = await service.getReleaseReadiness(ALCANCE_TENANT);

      expect(readiness.status).toBe('blocked');
      expect(readiness.blockers.map((c) => c.key)).toEqual(['endpoint_catalog']);
      expect(readiness.warnings.map((c) => c.key)).toEqual(['open_quality_issues']);
    });

    it('sin suites ni reglas ni jobs queda en ámbar, no en rojo: son avisos, no bloqueos', async () => {
      cuentas.system_test_suites = 0;
      cuentas.data_quality_rules = 0;
      cuentas.system_job_runs = 0;

      const readiness = await service.getReleaseReadiness(ALCANCE_TENANT);

      expect(readiness.status).toBe('warning');
      expect(readiness.warnings.map((c) => c.key)).toEqual(['qa_suites', 'data_quality_rules', 'runtime_jobs']);
    });

    it('un conteo ilegible cuenta como cero en vez de propagar NaN al semáforo', async () => {
      query.mockResolvedValue([{ count: 'x' }] as never);

      const readiness = await service.getReleaseReadiness(ALCANCE_TENANT);

      expect(readiness.status).toBe('blocked');
      expect(readiness.checks.every((check) => !check.detail.includes('NaN'))).toBe(true);
    });
  });

  describe('catálogo de reportes', () => {
    it('la lista no lleva widgets ni filtros: son el cuerpo del reporte, no su ficha', async () => {
      const resultado = await service.listReports({ page: 1, limit: 50 });

      expect(resultado.items.length).toBeGreaterThan(0);
      expect(resultado.items[0]).not.toHaveProperty('widgets');
      expect(resultado.items[0]).not.toHaveProperty('filters');
    });

    it('un reporte se encuentra por su identificador o por su clave', () => {
      expect(service.getReport('operations-overview').reportId).toBe('operations-overview');
      expect(service.getReport('operations_overview').reportId).toBe('operations-overview');
    });

    it('un reporte que no existe es 404', () => {
      expect(() => service.getReport('no-existe')).toThrow(NotFoundException);
    });
  });

  describe('ejecutar un reporte', () => {
    it('computa en vivo y lo declara: no persiste ni devuelve un identificador de ejecución', async () => {
      const resultado = await service.runReport(ALCANCE_TENANT, 'operations-overview', {});

      expect(resultado.persisted).toBe(false);
      expect(resultado).not.toHaveProperty('executionId');
      expect(Date.parse(resultado.computedAt)).not.toBeNaN();
    });

    it('las alertas y los jobs se piden CON el alcance del actor', async () => {
      await service.runReport(ALCANCE_TENANT, 'operations-overview', {});

      expect(operations.listAlerts).toHaveBeenCalledWith(ALCANCE_TENANT, { page: 1, limit: 10 });
      expect(operations.listJobs).toHaveBeenCalledWith(ALCANCE_TENANT, { page: 1, limit: 10 });
    });

    it('cada widget recibe el resumen ya resuelto: el portal no vuelve a contar', async () => {
      const resultado = await service.runReport(ALCANCE_TENANT, 'operations-overview', {});

      expect(resultado.widgets.length).toBeGreaterThan(0);
      for (const widget of resultado.widgets) {
        expect(widget.data).toEqual({ readinessStatus: 'ready', alertCount: 1, jobCount: 3 });
      }
    });

    it('los filtros llegan del cuerpo, y sin envoltorio se toma el cuerpo entero', async () => {
      const conEnvoltorio = await service.runReport(ALCANCE_TENANT, 'operations-overview', { filters: { from: '2026-01-01' } });
      expect(conEnvoltorio.data.filters).toEqual({ from: '2026-01-01' });

      const sinEnvoltorio = await service.runReport(ALCANCE_TENANT, 'operations-overview', { from: '2026-01-01' });
      expect(sinEnvoltorio.data.filters).toEqual({ from: '2026-01-01' });
    });

    it('un reporte inexistente falla antes de tocar la base', async () => {
      query.mockClear();

      await expect(service.runReport(ALCANCE_TENANT, 'no-existe', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(query).not.toHaveBeenCalled();
    });
  });
});
