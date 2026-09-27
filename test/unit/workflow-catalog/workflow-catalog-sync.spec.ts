import { describe, expect, it, jest } from '@jest/globals';
import {
  definitionHash,
  endpointCodeFor,
  stepEndpointCode,
  syncWorkflowCatalog,
} from '../../../src/modules/workflow-catalog/definitions/workflow-catalog.sync.js';
import type { WorkflowDefinitionFixture } from '../../../src/modules/workflow-catalog/definitions/workflow-definition.types.js';

const FIXTURE: WorkflowDefinitionFixture = {
  processId: 'P-99',
  code: 'prueba_volcado',
  version: 'v1',
  name: 'Proceso de prueba',
  description: 'Sólo para las pruebas del volcado.',
  processType: 'back_office',
  ownerDomain: 'testing',
  ownerRole: 'QA_ENGINEER',
  priority: 'P2',
  systems: ['ATLAS_BACKEND'],
  narrative: { whyExists: 'a', whoStartsAndCloses: 'b', startAndEnd: 'c', whenItFails: 'd', healthIndicator: 'e' },
  success: 's',
  failure: 'f',
  sources: ['test'],
  stages: [
    {
      code: 'madre',
      name: 'Madre',
      description: 'x',
      module: 'm',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      entry: true,
      steps: [{ code: 'a', name: 'A', description: 'x', method: 'GET', path: '/x/:id' }],
    },
    {
      code: 'hija',
      name: 'Hija',
      description: 'x',
      module: 'm',
      actor: 'system',
      client: 'BLOCK',
      parent: 'madre',
      terminal: true,
      steps: [{ code: 'b', name: 'B', description: 'x', kind: 'job', job: 'process_outbox' }],
    },
  ],
};

/** Una base falsa que devuelve un `_id` por inserción y anota cada sentencia. */
function fakeQueryInterface() {
  let next = 1;
  const calls: Array<{ sql: string; replacements: Record<string, unknown> }> = [];
  const query = jest.fn(async (sql: string, options: { replacements?: Record<string, unknown> } = {}) => {
    calls.push({ sql, replacements: options.replacements ?? {} });
    return [/RETURNING _id/.test(sql) ? [{ _id: String(next++) }] : [], 0];
  });
  const sequelize = { query, transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({})) };
  return { qi: { sequelize } as never, calls };
}

describe('códigos lógicos de los pasos', () => {
  it('un paso http usa el mismo código que el catálogo de endpoints', () => {
    expect(endpointCodeFor('get', '/customers/:customerId/workflow-progress')).toBe('GET_CUSTOMERS_BY_CUSTOMERID_WORKFLOW_PROGRESS');
  });

  it('un paso que no es http lleva su naturaleza como prefijo', () => {
    expect(stepEndpointCode({ code: 'x', name: 'x', description: 'x', kind: 'job', job: 'process_outbox' })).toBe('JOB_PROCESS_OUTBOX');
    expect(stepEndpointCode({ code: 'firma.papel', name: 'x', description: 'x', kind: 'manual', reason: 'se firma en papel' })).toBe(
      'MANUAL_FIRMA_PAPEL',
    );
  });
});

describe('definitionHash', () => {
  it('no cambia al reordenar propiedades y sí al cambiar el contenido', () => {
    const reordered = Object.fromEntries(Object.entries(FIXTURE).reverse()) as WorkflowDefinitionFixture;
    expect(definitionHash(reordered)).toBe(definitionHash(FIXTURE));
    expect(definitionHash({ ...FIXTURE, name: 'otro' })).not.toBe(definitionHash(FIXTURE));
  });
});

describe('syncWorkflowCatalog', () => {
  it('escribe la madre antes que la hija y le pasa su _id', async () => {
    const { qi, calls } = fakeQueryInterface();
    await syncWorkflowCatalog(qi, [FIXTURE], 'test');
    const stages = calls.filter((c) => /INSERT INTO .*workflow_stages/s.test(c.sql));
    expect(stages.map((c) => c.replacements.code)).toEqual(['madre', 'hija']);
    // _id 1 es la definición, 2 la madre: la hija tiene que apuntar a 2.
    expect(stages[1]!.replacements.parentId).toBe('2');
  });

  it('un paso que no es http se guarda sin método ni ruta y con su job', async () => {
    const { qi, calls } = fakeQueryInterface();
    await syncWorkflowCatalog(qi, [FIXTURE], 'test');
    const job = calls.find((c) => /INSERT INTO .*workflow_steps/s.test(c.sql) && c.replacements.code === 'b')!;
    expect(job.replacements).toMatchObject({ method: null, path: null, kind: 'job', job: 'process_outbox', auth: false });
  });

  it('retira lo que la fixture ya no declara y deja la huella del contenido', async () => {
    const { qi, calls } = fakeQueryInterface();
    await syncWorkflowCatalog(qi, [FIXTURE], 'test');
    expect(calls.some((c) => /UPDATE .*workflow_steps SET _deleted = true/s.test(c.sql))).toBe(true);
    const sync = calls.find((c) => /workflow_definitions_sync/.test(c.sql))!;
    expect(sync.replacements).toMatchObject({ code: 'prueba_volcado', hash: definitionHash(FIXTURE) });
  });

  it('una dependencia que nombra un paso inexistente rompe el volcado en vez de escribir NULL', async () => {
    const { qi } = fakeQueryInterface();
    const broken = { ...FIXTURE, dependencies: [{ step: 'a', dependsOn: 'fantasma', type: 'soft' }] };
    await expect(syncWorkflowCatalog(qi, [broken], 'test')).rejects.toThrow('WORKFLOW_SYNC_UNKNOWN_STEP');
  });
});
