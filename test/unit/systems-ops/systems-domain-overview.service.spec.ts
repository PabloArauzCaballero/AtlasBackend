import { describe, expect, it } from '@jest/globals';
import { SystemsDomainOverviewService } from '../../../src/modules/systems-ops/systems-domain-overview.service.js';

/**
 * El mapa de dominios se calculaba en el navegador sobre tres listados paginados a 100 filas. Aquí
 * se comprueba que el servidor lo calcula ENTERO y con la relación real: tabla→dominio y
 * endpoint→tablas que toca.
 */
function modelWith<T>(rows: T[]) {
  return { findAll: async () => rows } as never;
}

function build(input: {
  domains?: Record<string, unknown>[];
  entities: Record<string, unknown>[];
  endpoints: Record<string, unknown>[];
  impacts: Record<string, unknown>[];
  suites?: Record<string, unknown>[];
}) {
  return new SystemsDomainOverviewService(
    modelWith(input.domains ?? []),
    modelWith(input.entities),
    modelWith(input.endpoints),
    modelWith(input.impacts),
    modelWith(input.suites ?? []),
  );
}

const domainRow = (domainCode: string, domainName: string) => ({
  id: 1,
  domainCode,
  domainName,
  description: 'd',
  businessDefinition: null,
  technicalScope: null,
  dataNature: 'OPERACIONAL',
  ownerTeam: 'equipo',
  countriesApplicable: null,
  regulatoryNotes: null,
  exampleTables: [],
  decisionUseCases: [],
  auditRelevance: null,
  status: 'ACTIVE',
});

describe('SystemsDomainOverviewService', () => {
  it('cuenta tablas, PII, revisión pendiente y endpoints por dominio a partir de los impactos', async () => {
    const service = build({
      domains: [domainRow('CREDITO', 'Crédito'), domainRow('PLATAFORMA', 'Plataforma')],
      entities: [
        { id: 10, tableName: 'loans', module: 'credit', domainCode: 'CREDITO', containsPii: false, reviewStatus: 'APPROVED' },
        { id: 11, tableName: 'customers', module: 'customers', domainCode: 'CREDITO', containsPii: true, reviewStatus: 'NEEDS_REVIEW' },
        { id: 12, tableName: 'tenants', module: 'platform', domainCode: 'PLATAFORMA', containsPii: false, reviewStatus: 'APPROVED' },
      ],
      endpoints: [
        { id: 100, module: 'loans', riskLevel: 'HIGH', reviewStatus: 'APPROVED' },
        { id: 101, module: 'admin', riskLevel: 'LOW', reviewStatus: 'AUTO_DETECTED' },
        { id: 102, module: 'health', riskLevel: 'LOW', reviewStatus: 'APPROVED' },
      ],
      impacts: [
        { endpointId: 100, dataEntityId: 10 },
        { endpointId: 100, dataEntityId: 11 }, // el mismo endpoint toca dos tablas del MISMO dominio: cuenta una vez
        { endpointId: 101, dataEntityId: 12 },
      ],
      suites: [{ id: 1, module: 'credit' }],
    });

    const result = await service.overview();

    expect(result.domainSource).toBe('catalog');
    const credito = result.items.find((item) => item.domainCode === 'CREDITO')!;
    expect(credito).toMatchObject({
      tables: 2,
      piiTables: 1,
      endpoints: 1,
      criticalEndpoints: 1,
      testSuites: 1,
      pendingReview: 1,
      modules: ['credit', 'customers'],
    });
    const plataforma = result.items.find((item) => item.domainCode === 'PLATAFORMA')!;
    expect(plataforma).toMatchObject({ tables: 1, endpoints: 1, pendingReview: 1, criticalEndpoints: 0 });
    // El endpoint de health no toca ninguna tabla: no es de ningún dominio y se dice.
    expect(result.unassigned).toEqual({ tables: 0, endpoints: 1, modules: [] });
    expect(result.totals).toEqual({ tables: 3, endpoints: 3, testSuites: 1 });
  });

  it('con el catálogo de dominios vacío usa las fichas en código y asigna las tablas por su nombre', async () => {
    const service = build({
      domains: [],
      entities: [
        // Sin domain_code, pero `tenants` está en TABLE_BUSINESS_METADATA (PLATAFORMA).
        { id: 1, tableName: 'tenants', module: 'platform', domainCode: null, containsPii: false, reviewStatus: 'APPROVED' },
        { id: 2, tableName: 'tabla_inventada', module: 'raro', domainCode: null, containsPii: false, reviewStatus: 'APPROVED' },
      ],
      endpoints: [],
      impacts: [],
    });

    const result = await service.overview();

    expect(result.domainSource).toBe('fixtures');
    expect(result.items.length).toBeGreaterThanOrEqual(15);
    expect(result.items.find((item) => item.domainCode === 'PLATAFORMA')?.tables).toBe(1);
    expect(result.items.reduce((sum, item) => sum + item.tables, 0)).toBe(1);
    expect(result.unassigned).toEqual({ tables: 1, endpoints: 0, modules: [{ module: 'raro', tables: 1 }] });
  });

  it('un endpoint que toca tablas de dos dominios cuenta en los dos', async () => {
    const service = build({
      domains: [domainRow('A', 'A'), domainRow('B', 'B')],
      entities: [
        { id: 1, tableName: 'x', module: 'm', domainCode: 'A', containsPii: false, reviewStatus: 'APPROVED' },
        { id: 2, tableName: 'y', module: 'm', domainCode: 'B', containsPii: false, reviewStatus: 'APPROVED' },
      ],
      endpoints: [{ id: 9, module: 'm', riskLevel: 'CRITICAL', reviewStatus: 'APPROVED' }],
      impacts: [
        { endpointId: 9, dataEntityId: 1 },
        { endpointId: 9, dataEntityId: 2 },
      ],
    });
    const result = await service.overview();
    expect(result.items.map((item) => [item.domainCode, item.endpoints, item.criticalEndpoints])).toEqual([
      ['A', 1, 1],
      ['B', 1, 1],
    ]);
  });
});
