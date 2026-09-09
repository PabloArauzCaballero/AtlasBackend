import {
  findingKeyFor,
  flowBadgesFor,
  flowIdFor,
  flowKindFor,
  flowNameFor,
  flowRiskFor,
  flowRiskFromTables,
  flowSlugFor,
} from '../../src/modules/systems-ops/system-flows.risk.util.js';
import { buildFlowsWhere } from '../../src/modules/systems-ops/system-flows.repository.js';
import { flowRowFor } from '../../src/modules/systems-ops/system-flows.service.js';

const endpoint = (over: Partial<Parameters<typeof flowRowFor>[1]> = {}) => ({
  method: 'POST',
  path: 'credit/applications',
  module: 'credit',
  controller: 'CreditApplicationsController',
  handler: 'createApplication',
  isPublic: false,
  roles: ['customer'],
  internalPermissions: [],
  guards: [],
  callers: ['CONSUMER_APP'],
  testStatus: 'UNTESTED' as const,
  contractStatus: 'IN_CONTRACT' as const,
  ...over,
});

describe('flowKindFor', () => {
  it.each([
    ['GET', 'loans', 'READ'],
    ['POST', 'loans', 'CREATE'],
    ['POST', 'internal/jobs/:p/retry', 'ACTION'],
    ['POST', 'auth/login', 'ACTION'],
    ['PATCH', 'loans/:p', 'UPDATE'],
    ['DELETE', 'loans/:p', 'DELETE'],
  ])('%s /%s → %s', (method, path, kind) => {
    expect(flowKindFor(method, path)).toBe(kind);
  });
});

describe('flowRiskFor', () => {
  it('una escritura en un módulo crítico es CRITICAL', () => {
    expect(flowRiskFor(endpoint(), 'CREATE')).toBe('CRITICAL');
  });
  it('una lectura de un módulo crítico es MEDIUM', () => {
    expect(flowRiskFor(endpoint({ method: 'GET' }), 'READ')).toBe('MEDIUM');
  });
  it('una escritura pública sin roles fuera de auth es CRITICAL aunque el módulo no lo sea', () => {
    expect(flowRiskFor(endpoint({ module: 'app-content', isPublic: true, roles: [] }), 'CREATE')).toBe('CRITICAL');
  });
  it('el login público sigue siendo del módulo auth y no se dispara por ser público', () => {
    expect(flowRiskFor(endpoint({ module: 'auth', isPublic: true, roles: [] }), 'ACTION')).toBe('CRITICAL');
  });
  it('borrar en un módulo sin clasificar es HIGH', () => {
    expect(flowRiskFor(endpoint({ module: 'app-content' }), 'DELETE')).toBe('HIGH');
  });
  it('una lectura de catálogo es LOW', () => {
    expect(flowRiskFor(endpoint({ module: 'app-content', method: 'GET' }), 'READ')).toBe('LOW');
  });
});

describe('identidad y presentación', () => {
  it('el id depende sólo de bloque, método y ruta', () => {
    expect(flowIdFor('ATLAS_BACKEND', 'POST', 'credit/applications')).toBe(flowIdFor('ATLAS_BACKEND', 'POST', 'credit/applications'));
    expect(flowIdFor('ATLAS_BACKEND', 'POST', 'credit/applications')).not.toBe(flowIdFor('ERP_BACKEND', 'POST', 'credit/applications'));
    expect(flowIdFor('ATLAS_BACKEND', 'POST', 'credit/applications')).toMatch(/^flow_[a-f0-9]{12}$/);
  });
  it('el slug es kebab y quita el sufijo Controller', () => {
    expect(flowSlugFor('ATLAS_BACKEND', endpoint())).toBe('atlas-backend.credit.credit-applications.create-application');
  });
  it('el nombre separa el camelCase y conserva método y ruta', () => {
    expect(flowNameFor(endpoint())).toBe('Create application (POST /credit/applications)');
  });
  it('las insignias salen del módulo y del tipo', () => {
    expect(flowBadgesFor({ module: 'loans' }, 'DELETE')).toEqual(['DESTRUCTIVE', 'FINANCIAL']);
    expect(flowBadgesFor({ module: 'internal-users' }, 'READ')).toEqual(['IDENTITY', 'ADMIN']);
  });
  it('la clave del hallazgo es estable por tipo, bloque y referencia', () => {
    const key = findingKeyFor({ kind: 'CONTRACT_DRIFT', systemCode: 'ERP_BACKEND', ref: 'POST auth/login' });
    expect(key).toHaveLength(40);
    expect(findingKeyFor({ kind: 'CONTRACT_DRIFT', systemCode: 'ERP_BACKEND', ref: 'POST auth/login' })).toBe(key);
  });
});

describe('flowRowFor', () => {
  it('arma la fila completa con los tres ejes en su estado inicial', () => {
    const row = flowRowFor('ATLAS_BACKEND', endpoint(), { analyzedCommit: 'abc', analyzedBranch: 'dev', importId: '7' });
    expect(row).toMatchObject({
      systemCode: 'ATLAS_BACKEND',
      kind: 'CREATE',
      risk: 'CRITICAL',
      riskBasis: 'module-heuristic',
      discovery: 'DISCOVERED',
      verification: 'UNVERIFIED',
      freshness: 'FRESH',
      httpMethod: 'POST',
      path: 'credit/applications',
      callers: ['CONSUMER_APP'],
      analyzedCommit: 'abc',
      importId: '7',
      findingsCount: 0,
    });
  });
});

describe('buildFlowsWhere', () => {
  it('traduce cada filtro a su columna y deja fuera los ausentes', () => {
    const where = buildFlowsWhere({
      page: 1,
      limit: 20,
      systemCode: 'ERP_BACKEND',
      risk: 'HIGH',
      tested: false,
      withFindings: true,
    }) as Record<string, unknown>;
    expect(where.systemCode).toBe('ERP_BACKEND');
    expect(where.risk).toBe('HIGH');
    expect(where.testStatus).toBe('UNTESTED');
    expect(where.findingsCount).toBeDefined();
    expect(where.module).toBeUndefined();
  });
});

describe('flowRiskFromTables (fase 2)', () => {
  const analysis = (writes: string[], reads: string[] = []) => ({
    status: 'MAPPED' as const,
    chain: [],
    reads,
    writes: writes.map((table) => ({ table, op: 'INSERT', via: 'SEQUELIZE' })),
    errors: [],
    blockCalls: [],
    unknowns: [],
    transactional: false,
  });
  it('escribir en loans es CRITICAL aunque el módulo no lo sea', () => {
    expect(flowRiskFromTables(analysis(['loans']), 'CREATE', false)).toBe('CRITICAL');
  });
  it('escribir en customers es HIGH; en un catálogo, MEDIUM', () => {
    expect(flowRiskFromTables(analysis(['customers']), 'UPDATE', false)).toBe('HIGH');
    expect(flowRiskFromTables(analysis(['app_content_entries']), 'CREATE', false)).toBe('MEDIUM');
  });
  it('leer identidad sin escribir es MEDIUM; leer un catálogo, LOW', () => {
    expect(flowRiskFromTables(analysis([], ['customer_identity_documents']), 'READ', false)).toBe('MEDIUM');
    expect(flowRiskFromTables(analysis([], ['catalog_entries']), 'READ', false)).toBe('LOW');
  });
  it('la fila usa tables-written cuando hay análisis y conserva reads/writes desnormalizados', () => {
    const row = flowRowFor('ATLAS_BACKEND', endpoint({ module: 'app-content', analysis: analysis(['loans', 'loans'], ['customers']) }), {
      importId: null,
    });
    expect(row.riskBasis).toBe('tables-written');
    expect(row.risk).toBe('CRITICAL');
    expect(row.discovery).toBe('MAPPED');
    expect(row.writes).toEqual(['loans']);
    expect(row.reads).toEqual(['customers']);
  });
});
