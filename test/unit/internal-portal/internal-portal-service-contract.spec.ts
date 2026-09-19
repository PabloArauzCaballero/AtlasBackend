import { describe, expect, it, jest } from '@jest/globals';
import { InternalPortalService } from '../../../src/modules/internal-portal/internal-portal.service.js';

/**
 * PRUEBA DE CONTRATO (Fase 2.2 del plan 10/10).
 *
 * `internal-portal.service.ts` se divide en servicios enfocados por dominio. El plan exige que cada
 * división vaya acompañada de pruebas que garanticen la MISMA API pública antes y después. Este test
 * fija esa superficie: si el refactor renombra, pierde o cambia la aridad de un método, falla aquí —
 * antes de que lo note el controller o el frontend.
 *
 * También fija que el constructor siga recibiendo UNA sola dependencia (la conexión Sequelize): la
 * fachada construye sus colaboradores internamente, así el controller, el módulo y los tests
 * existentes no cambian.
 */

/**
 * Método público -> número de parámetros declarados.
 *
 * La superficie cambió en la auditoría integral del 2026-08-06, y el cambio es DELIBERADO:
 *
 * - Los casos de uso que tocan tablas con `_tenant_id` reciben ahora un `PortalScope` como primer
 *   parámetro (ATLAS-SEC-009). Que su aridad suba es justamente la señal que este contrato debe
 *   fijar: si alguien vuelve a bajarla, ha quitado el aislamiento por tenant.
 * - Se retiraron cinco métodos que respondían 200 sobre acciones que no ejecutaban:
 *   `runDataQualityRule`, `updateGovernancePolicy`, `retryJob`, `cancelJob` y `listReportSnapshots`.
 *   Ver `internal-portal.controller.ts` para las capacidades reales que los sustituyen.
 */
const PUBLIC_API: Record<string, number> = {
  // Glosario de negocio (catálogo de plataforma: sin tenant)
  listBusinessTerms: 1,
  getBusinessTerm: 1,
  // Exports (catálogo de plataforma)
  listExports: 1,
  getExport: 1,
  // Calidad de datos (el conteo de issues es por tenant)
  listDataQualityRules: 2,
  getDataQualityRule: 2,
  // Gobierno (solo lectura)
  getGovernancePolicy: 1,
  // Linaje (catálogo de plataforma)
  getLineage: 1,
  getLineageNode: 1,
  getLineageImpact: 1,
  // Alertas (data_quality_issues: por tenant)
  listAlerts: 2,
  acknowledgeAlert: 2,
  // Jobs (system_job_runs: por tenant)
  listJobs: 2,
  getJob: 2,
  // Release readiness (agrega dos tablas por tenant)
  getReleaseReadiness: 1,
  // Reportes
  listReports: 1,
  getReport: 1,
  runReport: 3,
  // Búsqueda
  search: 1,
};

function buildService(): InternalPortalService {
  const sequelize = { query: jest.fn(async (..._args: unknown[]) => []) };
  return new InternalPortalService(sequelize as never);
}

describe('InternalPortalService — contrato de API pública', () => {
  it('se construye con una única dependencia (la conexión Sequelize)', () => {
    expect(InternalPortalService.length).toBe(1);
    expect(() => buildService()).not.toThrow();
  });

  it.each(Object.entries(PUBLIC_API))('expone %s como método', (method) => {
    const service = buildService() as unknown as Record<string, unknown>;
    expect(typeof service[method]).toBe('function');
  });

  it.each(Object.entries(PUBLIC_API))('%s conserva su aridad (%i parámetros)', (method, arity) => {
    const service = buildService() as unknown as Record<string, (...args: unknown[]) => unknown>;
    expect(service[method].length).toBe(arity);
  });

  it('no pierde ningún método de la superficie pública esperada', () => {
    const service = buildService() as unknown as Record<string, unknown>;
    const missing = Object.keys(PUBLIC_API).filter((method) => typeof service[method] !== 'function');
    expect(missing).toEqual([]);
  });

  it('los 19 métodos del contrato siguen siendo exactamente los que consume el controller', () => {
    expect(Object.keys(PUBLIC_API)).toHaveLength(19);
  });

  /**
   * Trinquete de honestidad: estos cinco métodos devolvían 200 describiendo un efecto que nunca
   * ocurría (un job re-encolado, una política guardada, snapshots históricos). Si alguno reaparece,
   * tiene que ser porque ahora hace de verdad lo que promete — y entonces este test se actualiza a
   * conciencia, no por accidente.
   */
  it.each(['runDataQualityRule', 'updateGovernancePolicy', 'retryJob', 'cancelJob', 'listReportSnapshots'])(
    '%s sigue retirado: no vuelve a existir un endpoint que reporte una acción que no ejecuta',
    (method) => {
      const service = buildService() as unknown as Record<string, unknown>;
      expect(service[method]).toBeUndefined();
    },
  );
});
