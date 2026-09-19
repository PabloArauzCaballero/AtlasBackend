import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { InternalPortalController } from '../../../src/modules/internal-portal/internal-portal.controller.js';
import { InternalPortalService } from '../../../src/modules/internal-portal/internal-portal.service.js';
import { PortalDataQualityService } from '../../../src/modules/internal-portal/application/portal-data-quality.service.js';
import { PortalGlossaryService } from '../../../src/modules/internal-portal/application/portal-glossary.service.js';
import { PortalGovernanceService } from '../../../src/modules/internal-portal/application/portal-governance.service.js';
import { PortalLineageService } from '../../../src/modules/internal-portal/application/portal-lineage.service.js';
import { PortalOperationsService } from '../../../src/modules/internal-portal/application/portal-operations.service.js';
import { PortalReportsService } from '../../../src/modules/internal-portal/application/portal-reports.service.js';
import { PortalSearchService } from '../../../src/modules/internal-portal/application/portal-search.service.js';
import type { PortalScope } from '../../../src/modules/internal-portal/application/portal-scope.util.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

/**
 * El cableado del portal interno: qué ruta llama a qué, y con qué alcance.
 *
 * Un cruce entre dos métodos que devuelven listas parecidas —`listJobs` donde va `listAlerts`, o
 * `getReport` donde va `getExport`— compila, responde 200 y enseña datos equivocados sin un solo
 * error en ningún log. Ninguna prueba de los servicios lo detecta, porque cada servicio hace bien
 * lo suyo. Sólo se ve desde arriba.
 *
 * Y encima de eso está ATLAS-SEC-009: de las veinte rutas, siete pasan un alcance por tenant y
 * trece no. Esa lista no es arbitraria —son exactamente las que tocan `data_quality_issues` y
 * `system_job_runs`, las dos únicas tablas del portal con `_tenant_id`—, así que se fija entera: una
 * ruta que deje de pasar el alcance reabre la fuga verificada en vivo, y una que lo pase de más
 * empieza a esconder catálogo de plataforma que debe ser igual para todos.
 */
const ACTOR_TENANT = { role: 'internal_operator', tenantId: 't1' } as AuthenticatedUser;
const ACTOR_PLATAFORMA = { role: 'platform_admin', tenantId: 't1' } as AuthenticatedUser;
const ALCANCE_TENANT: PortalScope = { tenantId: 't1', allTenants: false };

const CONSULTA = { page: 1, limit: 20 } as never;

describe('cableado del portal interno', () => {
  describe('fachada → colaborador', () => {
    let service: InternalPortalService;

    beforeEach(() => {
      service = new InternalPortalService({ query: jest.fn(async () => []) } as unknown as Sequelize);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /** Espía el método del colaborador y comprueba que la fachada le pasa sus argumentos tal cual. */
    async function delegaEn<T extends object>(
      prototipo: T,
      metodo: keyof T & string,
      invocar: () => unknown,
      argumentosEsperados: unknown[],
    ): Promise<void> {
      const espia = jest.spyOn(prototipo, metodo as never).mockReturnValue('resultado' as never);

      await expect(Promise.resolve(invocar())).resolves.toBe('resultado');

      expect(espia).toHaveBeenCalledTimes(1);
      expect(espia.mock.calls[0]).toEqual(argumentosEsperados);
    }

    it('el glosario va al servicio de glosario', async () => {
      await delegaEn(PortalGlossaryService.prototype, 'listBusinessTerms', () => service.listBusinessTerms(CONSULTA), [CONSULTA]);
      await delegaEn(PortalGlossaryService.prototype, 'getBusinessTerm', () => service.getBusinessTerm('t-1'), ['t-1']);
    });

    it('exports, reportes y release readiness van al servicio de reportes', async () => {
      await delegaEn(PortalReportsService.prototype, 'listExports', () => service.listExports(CONSULTA), [CONSULTA]);
      await delegaEn(PortalReportsService.prototype, 'getExport', () => service.getExport('e-1'), ['e-1']);
      await delegaEn(PortalReportsService.prototype, 'listReports', () => service.listReports(CONSULTA), [CONSULTA]);
      await delegaEn(PortalReportsService.prototype, 'getReport', () => service.getReport('r-1'), ['r-1']);
      await delegaEn(PortalReportsService.prototype, 'getReleaseReadiness', () => service.getReleaseReadiness(ALCANCE_TENANT), [
        ALCANCE_TENANT,
      ]);
      await delegaEn(PortalReportsService.prototype, 'runReport', () => service.runReport(ALCANCE_TENANT, 'r-1', { filtro: 1 } as never), [
        ALCANCE_TENANT,
        'r-1',
        { filtro: 1 },
      ]);
    });

    it('la calidad de datos va al servicio de calidad, con el alcance por delante', async () => {
      await delegaEn(
        PortalDataQualityService.prototype,
        'listDataQualityRules',
        () => service.listDataQualityRules(ALCANCE_TENANT, CONSULTA),
        [ALCANCE_TENANT, CONSULTA],
      );
      await delegaEn(PortalDataQualityService.prototype, 'getDataQualityRule', () => service.getDataQualityRule(ALCANCE_TENANT, 'q-1'), [
        ALCANCE_TENANT,
        'q-1',
      ]);
    });

    it('el gobierno va al servicio de gobierno', async () => {
      await delegaEn(PortalGovernanceService.prototype, 'getGovernancePolicy', () => service.getGovernancePolicy('p-1'), ['p-1']);
    });

    it('las tres vistas de linaje van al servicio de linaje y no se cruzan entre sí', async () => {
      await delegaEn(PortalLineageService.prototype, 'getLineage', () => service.getLineage(CONSULTA), [CONSULTA]);
      await delegaEn(PortalLineageService.prototype, 'getLineageNode', () => service.getLineageNode('n-1'), ['n-1']);
      await delegaEn(PortalLineageService.prototype, 'getLineageImpact', () => service.getLineageImpact(CONSULTA), [CONSULTA]);
    });

    it('alertas y jobs van al servicio de operaciones, cada uno al suyo', async () => {
      await delegaEn(PortalOperationsService.prototype, 'listAlerts', () => service.listAlerts(ALCANCE_TENANT, CONSULTA), [
        ALCANCE_TENANT,
        CONSULTA,
      ]);
      await delegaEn(PortalOperationsService.prototype, 'acknowledgeAlert', () => service.acknowledgeAlert(ALCANCE_TENANT, 'a-1'), [
        ALCANCE_TENANT,
        'a-1',
      ]);
      await delegaEn(PortalOperationsService.prototype, 'listJobs', () => service.listJobs(ALCANCE_TENANT, CONSULTA), [
        ALCANCE_TENANT,
        CONSULTA,
      ]);
      await delegaEn(PortalOperationsService.prototype, 'getJob', () => service.getJob(ALCANCE_TENANT, 'j-1'), [ALCANCE_TENANT, 'j-1']);
    });

    it('la búsqueda va al servicio de búsqueda', async () => {
      await delegaEn(PortalSearchService.prototype, 'search', () => service.search(CONSULTA), [CONSULTA]);
    });
  });

  describe('controlador → fachada', () => {
    let service: Record<string, jest.Mock>;
    let controller: InternalPortalController;

    beforeEach(() => {
      service = Object.fromEntries(
        [
          'listBusinessTerms',
          'getBusinessTerm',
          'listExports',
          'getExport',
          'listDataQualityRules',
          'getDataQualityRule',
          'getGovernancePolicy',
          'getLineage',
          'getLineageNode',
          'getLineageImpact',
          'listAlerts',
          'acknowledgeAlert',
          'listJobs',
          'getJob',
          'getReleaseReadiness',
          'listReports',
          'getReport',
          'runReport',
          'search',
        ].map((nombre) => [nombre, jest.fn(() => `resultado:${nombre}`)]),
      );
      controller = new InternalPortalController(service as unknown as InternalPortalService);
    });

    it('cada ruta llama al método que dice su nombre y devuelve su resultado sin tocarlo', () => {
      const rutas: Array<[string, unknown, string]> = [
        ['listBusinessTerms', controller.listBusinessTerms(CONSULTA), 'listBusinessTerms'],
        ['getBusinessTerm', controller.getBusinessTerm({ termId: 't-1' }), 'getBusinessTerm'],
        ['listExports', controller.listExports(CONSULTA), 'listExports'],
        ['getExport', controller.getExport({ exportId: 'e-1' }), 'getExport'],
        ['getGovernancePolicy', controller.getGovernancePolicy({ policyId: 'p-1' }), 'getGovernancePolicy'],
        ['getLineage', controller.getLineage(CONSULTA), 'getLineage'],
        ['getLineageNode', controller.getLineageNode({ nodeId: 'n-1' }), 'getLineageNode'],
        ['getLineageImpact', controller.getLineageImpact(CONSULTA), 'getLineageImpact'],
        ['listReports', controller.listReports(CONSULTA), 'listReports'],
        ['getReport', controller.getReport({ reportId: 'r-1' }), 'getReport'],
        ['search', controller.search(CONSULTA), 'search'],
      ];

      for (const [metodo, resultado, esperado] of rutas) {
        expect(service[metodo]).toHaveBeenCalledTimes(1);
        expect(resultado).toBe(`resultado:${esperado}`);
      }
    });

    it('los identificadores viajan desenvueltos del parámetro de ruta, no el objeto entero', () => {
      controller.getBusinessTerm({ termId: 't-1' });
      controller.getExport({ exportId: 'e-1' });
      controller.getLineageNode({ nodeId: 'n-1' });
      controller.getReport({ reportId: 'r-1' });

      expect(service.getBusinessTerm).toHaveBeenCalledWith('t-1');
      expect(service.getExport).toHaveBeenCalledWith('e-1');
      expect(service.getLineageNode).toHaveBeenCalledWith('n-1');
      expect(service.getReport).toHaveBeenCalledWith('r-1');
    });

    it('las siete rutas que tocan tablas con `_tenant_id` pasan el alcance del actor', () => {
      controller.listDataQualityRules(CONSULTA, ACTOR_TENANT);
      controller.getDataQualityRule({ ruleId: 'q-1' }, ACTOR_TENANT);
      controller.listAlerts(CONSULTA, ACTOR_TENANT);
      controller.acknowledgeAlert({ alertId: 'a-1' }, ACTOR_TENANT);
      controller.listJobs(CONSULTA, ACTOR_TENANT);
      controller.getJob({ jobRunId: 'j-1' }, ACTOR_TENANT);
      controller.getReleaseReadiness(ACTOR_TENANT);
      controller.runReport({ reportId: 'r-1' }, { filtro: 1 } as never, ACTOR_TENANT);

      expect(service.listDataQualityRules).toHaveBeenCalledWith(ALCANCE_TENANT, CONSULTA);
      expect(service.getDataQualityRule).toHaveBeenCalledWith(ALCANCE_TENANT, 'q-1');
      expect(service.listAlerts).toHaveBeenCalledWith(ALCANCE_TENANT, CONSULTA);
      expect(service.acknowledgeAlert).toHaveBeenCalledWith(ALCANCE_TENANT, 'a-1');
      expect(service.listJobs).toHaveBeenCalledWith(ALCANCE_TENANT, CONSULTA);
      expect(service.getJob).toHaveBeenCalledWith(ALCANCE_TENANT, 'j-1');
      expect(service.getReleaseReadiness).toHaveBeenCalledWith(ALCANCE_TENANT);
      expect(service.runReport).toHaveBeenCalledWith(ALCANCE_TENANT, 'r-1', { filtro: 1 });
    });

    it('las rutas de catálogo de plataforma NO reciben alcance: son iguales para todos los tenants', () => {
      controller.listBusinessTerms(CONSULTA);
      controller.listExports(CONSULTA);
      controller.getLineage(CONSULTA);
      controller.search(CONSULTA);

      for (const metodo of ['listBusinessTerms', 'listExports', 'getLineage', 'search']) {
        expect(service[metodo]).toHaveBeenCalledWith(CONSULTA);
      }
    });

    it('un rol de plataforma consulta sobre todos los tenants', () => {
      controller.listAlerts(CONSULTA, ACTOR_PLATAFORMA);

      expect(service.listAlerts).toHaveBeenCalledWith({ tenantId: 't1', allTenants: true }, CONSULTA);
    });

    it('un rol de tenant sin tenant en el token falla cerrado antes de consultar nada', () => {
      const sinTenant = { role: 'internal_operator' } as AuthenticatedUser;

      expect(() => controller.listAlerts(CONSULTA, sinTenant)).toThrow(ForbiddenException);
      expect(service.listAlerts).not.toHaveBeenCalled();
    });
  });
});
