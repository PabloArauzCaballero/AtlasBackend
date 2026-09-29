import { describe, expect, it, jest } from '@jest/globals';
import { Sequelize } from 'sequelize-typescript';
import { SystemsCatalogSummaryService } from '../../../src/modules/systems-ops/systems-catalog-summary.service.js';

/**
 * Cifras del catálogo contadas en la base. La pantalla de gobierno las calculaba bajando el
 * catálogo entero al navegador; la de preparación del release, sobre las primeras 100 filas. Aquí se
 * fija la forma de la respuesta y que cada familia se cuente con `COUNT … FILTER` sobre su tabla; el
 * conteo real contra PostgreSQL lo mide la prueba de integración.
 */
describe('SystemsCatalogSummaryService', () => {
  it('cuenta tablas, rutas y suites con una consulta por familia y devuelve números', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM system_data_entity_catalog')) return [{ total: '186', withPurpose: 150, personalData: '40' }];
      if (sql.includes('FROM system_endpoint_catalog')) return [{ total: 432, testableFromPortal: '300', personalData: 12 }];
      return [{ total: '9', enabled: '7' }];
    });
    const service = new SystemsCatalogSummaryService({ query } as unknown as Sequelize);

    const summary = await service.summary();

    expect(query).toHaveBeenCalledTimes(3);
    expect(summary.tables).toEqual({ total: 186, withPurpose: 150, personalData: 40 });
    expect(summary.endpoints).toEqual({ total: 432, testableFromPortal: 300, personalData: 12 });
    expect(summary.testSuites).toEqual({ total: 9, enabled: 7 });
    for (const [sql] of query.mock.calls) expect(String(sql)).toContain('FILTER (WHERE');
  });

  it('un catálogo vacío responde ceros, no huecos', async () => {
    const service = new SystemsCatalogSummaryService({ query: jest.fn(async () => []) } as unknown as Sequelize);

    const summary = await service.summary();

    expect(summary).toMatchObject({ tables: {}, endpoints: {}, testSuites: {} });
  });
});
