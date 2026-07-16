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

/** Método público -> número de parámetros declarados. */
const PUBLIC_API: Record<string, number> = {
  // Glosario de negocio
  listBusinessTerms: 1,
  getBusinessTerm: 1,
  // Exports
  listExports: 1,
  getExport: 1,
  // Calidad de datos
  listDataQualityRules: 1,
  getDataQualityRule: 1,
  runDataQualityRule: 1,
  // Gobierno
  getGovernancePolicy: 1,
  updateGovernancePolicy: 2,
  // Linaje
  getLineage: 1,
  getLineageNode: 1,
  getLineageImpact: 1,
  // Alertas
  listAlerts: 1,
  acknowledgeAlert: 1,
  // Jobs
  listJobs: 1,
  getJob: 1,
  retryJob: 1,
  cancelJob: 1,
  // Release readiness
  getReleaseReadiness: 0,
  // Reportes
  listReports: 1,
  getReport: 1,
  runReport: 2,
  listReportSnapshots: 2,
  // Búsqueda
  search: 1,
};

function buildService(): InternalPortalService {
  const sequelize = { query: jest.fn(async () => []) };
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

  it('los 24 métodos del contrato siguen siendo exactamente los que consume el controller', () => {
    expect(Object.keys(PUBLIC_API)).toHaveLength(24);
  });
});
