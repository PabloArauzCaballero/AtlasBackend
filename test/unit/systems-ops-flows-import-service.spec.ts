import { SystemFlowsImportService } from '../../src/modules/systems-ops/system-flows.import.service.js';
import type { SystemFlowsRepository } from '../../src/modules/systems-ops/system-flows.repository.js';
import { importEndpointsSchema, importScreensSchema } from '../../src/modules/systems-ops/system-flows.schemas.js';

/**
 * `SystemFlowsImportService` con un doble hecho a mano del repositorio: lo que se protege es
 * cómo arma cada fila antes de guardarla y qué llama para dejar el catálogo consistente, no
 * el acceso a datos en sí (eso ya lo prueba `systems-ops-flows-repository.spec.ts`).
 */
type RepoDouble = { calls: Record<string, unknown[][]> } & Record<string, unknown>;

function repositoryDouble(): RepoDouble {
  const calls: Record<string, unknown[][]> = {};
  const spy =
    (name: string, result: (args: unknown[]) => unknown = () => undefined) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return Promise.resolve(result(args));
    };
  return {
    calls,
    transaction: (work: (tx: unknown) => Promise<unknown>) => work('tx'),
    createImport: spy('createImport', () => ({ id: '7', update: spy('importUpdate') })),
    // Devuelve 0 cambiados: lo que estas pruebas fijan es el orden y el contenido de la recarga.
    markStaleByDepsHash: spy('markStaleByDepsHash', () => []),
    markForReview: spy('markForReview', (args) => (args[0] as unknown[]).length),
    reopen: spy('reopen', (args) => (args[0] as unknown[]).length),
    reopenWithoutReviewedHash: spy('reopenWithoutReviewedHash', () => 0),
    release: spy('release', (args) => (args[0] as unknown[]).length),
    decisionsToBeRemoved: spy('decisionsToBeRemoved', () => 0),
    catalogSize: spy('catalogSize', () => 0),
    openFindingsOfSystem: spy('openFindingsOfSystem', () => 0),
    gatedScreensOfClient: spy('gatedScreensOfClient', () => 0),
    replaceFlows: spy('replaceFlows', (args) => ({ upserted: (args[1] as unknown[]).length, removed: 0 })),
    replaceScreens: spy('replaceScreens', (args) => ({ upserted: (args[1] as unknown[]).length, removed: 0 })),
    replaceFindings: spy('replaceFindings', (args) => ({ upserted: (args[1] as unknown[]).length, removed: 0 })),
    recountFindings: spy('recountFindings'),
  };
}

const endpoint = (over: Record<string, unknown> = {}) => ({
  method: 'GET',
  path: 'auth/me',
  module: 'auth',
  controller: 'AuthController',
  handler: 'me',
  isPublic: false,
  roles: [],
  internalPermissions: [],
  guards: [],
  callers: [],
  testStatus: 'UNTESTED' as const,
  contractStatus: 'NO_CONTRACT' as const,
  ...over,
});

describe('SystemFlowsImportService.importEndpoints', () => {
  it('registra la carga antes de escribir filas: el `importId` de las filas viene del import ya creado', async () => {
    const repo = repositoryDouble();
    await new SystemFlowsImportService(
      repo as unknown as SystemFlowsRepository,
      repo as never,
      repo as never,
      repo as never,
    ).importEndpoints(
      { systemCode: 'ATLAS_BACKEND', allowRemovingDecisions: false, declaredCount: 1, endpoints: [endpoint()] as never },
      'pablo',
    );
    expect(repo.calls.createImport?.[0]?.[0]).toMatchObject({ scope: 'endpoints', systemCode: 'ATLAS_BACKEND', createdBy: 'pablo' });
    const filas = repo.calls.replaceFlows?.[0]?.[1] as Array<{ importId: string }>;
    expect(filas[0].importId).toBe('7');
  });

  it('recuenta los hallazgos tras recargar el bloque: si no, un flujo que ya no existe conservaría su contador viejo', async () => {
    const repo = repositoryDouble();
    await new SystemFlowsImportService(
      repo as unknown as SystemFlowsRepository,
      repo as never,
      repo as never,
      repo as never,
    ).importEndpoints({ systemCode: 'ATLAS_BACKEND', allowRemovingDecisions: false, declaredCount: 0, endpoints: [] as never }, null);
    expect(repo.calls.recountFindings?.[0]?.[0]).toBe('ATLAS_BACKEND');
  });

  it('deja escrito cuántas filas se guardaron y cuántas se retiraron, no sólo el conteo recibido', async () => {
    const repo = repositoryDouble();
    const importUpdate = jest.fn(() => Promise.resolve(undefined));
    repo.createImport = (...args: unknown[]) => {
      (repo.calls.createImport ??= []).push(args);
      return Promise.resolve({ id: '7', update: importUpdate });
    };
    repo.replaceFlows = (...args: unknown[]) => {
      (repo.calls.replaceFlows ??= []).push(args);
      return Promise.resolve({ upserted: 1, removed: 3 });
    };
    const result = await new SystemFlowsImportService(
      repo as unknown as SystemFlowsRepository,
      repo as never,
      repo as never,
      repo as never,
    ).importEndpoints(
      { allowRemovingDecisions: false, systemCode: 'ATLAS_BACKEND', declaredCount: 1, endpoints: [endpoint()] as never },
      'pablo',
    );
    expect(importUpdate).toHaveBeenCalledWith({ rowsUpserted: 1, rowsRemoved: 3 }, { transaction: 'tx' });
    expect(result).toMatchObject({ importId: '7', upserted: 1, removed: 3 });
  });

  it('cada endpoint recibe el mismo commit y rama de la carga, no uno por fila', async () => {
    const repo = repositoryDouble();
    await new SystemFlowsImportService(
      repo as unknown as SystemFlowsRepository,
      repo as never,
      repo as never,
      repo as never,
    ).importEndpoints(
      {
        systemCode: 'ATLAS_BACKEND',
        allowRemovingDecisions: false,
        analyzedCommit: 'abc1234',
        analyzedBranch: 'dev',
        declaredCount: 2,
        endpoints: [endpoint({ path: 'a' }), endpoint({ path: 'b' })] as never,
      },
      null,
    );
    const filas = repo.calls.replaceFlows?.[0]?.[1] as Array<{ analyzedCommit: string; analyzedBranch: string }>;
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.analyzedCommit === 'abc1234' && f.analyzedBranch === 'dev')).toBe(true);
  });
});

describe('SystemFlowsImportService.importScreens', () => {
  it('mapea cada pantalla al bloque del cliente que la envía, no al de los flujos', async () => {
    const repo = repositoryDouble();
    await new SystemFlowsImportService(repo as unknown as SystemFlowsRepository, repo as never, repo as never, repo as never).importScreens(
      { clientCode: 'ADMIN_PORTAL', declaredCount: 1, screens: [{ route: '/internal/flows', navPermissions: [], navRoles: [] }] as never },
      'pablo',
    );
    expect(repo.calls.replaceScreens?.[0]?.[0]).toBe('ADMIN_PORTAL');
    const filas = repo.calls.replaceScreens?.[0]?.[1] as Array<Record<string, unknown>>;
    expect(filas[0]).toMatchObject({ clientCode: 'ADMIN_PORTAL', route: '/internal/flows', sourceFile: null, navLabel: null });
  });

  it('no recuenta hallazgos: las pantallas no los tienen y llamarlo ensuciaría un bloque que no es el de flujos', async () => {
    const repo = repositoryDouble();
    await new SystemFlowsImportService(repo as unknown as SystemFlowsRepository, repo as never, repo as never, repo as never).importScreens(
      { clientCode: 'ADMIN_PORTAL', declaredCount: 0, screens: [] as never },
      null,
    );
    expect(repo.calls.recountFindings).toBeUndefined();
  });

  it('un archivo o etiqueta de navegación ausentes se guardan como null, no como cadena vacía', async () => {
    const repo = repositoryDouble();
    await new SystemFlowsImportService(repo as unknown as SystemFlowsRepository, repo as never, repo as never, repo as never).importScreens(
      {
        clientCode: 'ADMIN_PORTAL',
        declaredCount: 1,
        screens: [{ route: '/x', file: 'X.tsx', navLabel: 'X', navPermissions: ['p'], navRoles: ['ADMIN'] }] as never,
      },
      null,
    );
    const fila = (repo.calls.replaceScreens?.[0]?.[1] as Array<Record<string, unknown>>)[0];
    expect(fila).toMatchObject({ sourceFile: 'X.tsx', navLabel: 'X', navPermissions: ['p'], navRoles: ['ADMIN'] });
  });
});

describe('SystemFlowsImportService.importFindings', () => {
  it('calcula la clave estable con `findingKeyFor`: la misma terna kind+systemCode+ref siempre produce la misma clave', async () => {
    const repo = repositoryDouble();
    await new SystemFlowsImportService(
      repo as unknown as SystemFlowsRepository,
      repo as never,
      repo as never,
      repo as never,
    ).importFindings(
      {
        systemCode: 'ATLAS_BACKEND',
        declaredCount: 1,
        findings: [
          { kind: 'CONTRACT_DRIFT', severity: 'HIGH', systemCode: 'ATLAS_BACKEND', ref: 'POST auth/login', summary: 'x' },
        ] as never,
      },
      null,
    );
    const fila = (repo.calls.replaceFindings?.[0]?.[1] as Array<Record<string, unknown>>)[0];
    expect(typeof fila.findingKey).toBe('string');
    expect(fila.findingKey).toHaveLength(40); // sha1 en hex
  });

  it('un hallazgo sin `extra` guarda un objeto vacío, no `undefined`', async () => {
    const repo = repositoryDouble();
    await new SystemFlowsImportService(
      repo as unknown as SystemFlowsRepository,
      repo as never,
      repo as never,
      repo as never,
    ).importFindings(
      {
        systemCode: 'ATLAS_BACKEND',
        declaredCount: 1,
        findings: [{ kind: 'k', severity: 'LOW', systemCode: 'ATLAS_BACKEND', ref: 'r', summary: 's' }] as never,
      },
      null,
    );
    const fila = (repo.calls.replaceFindings?.[0]?.[1] as Array<Record<string, unknown>>)[0];
    expect(fila.extraJson).toEqual({});
  });
});

describe('SystemFlowsImportService · frescura por flujo', () => {
  it('la frescura se decide ANTES de escribir: después ya no se sabría cuál era la huella anterior', async () => {
    const repo = repositoryDouble();
    await new SystemFlowsImportService(
      repo as unknown as SystemFlowsRepository,
      repo as never,
      repo as never,
      repo as never,
    ).importEndpoints({ systemCode: 'ATLAS_BACKEND', declaredCount: 1, endpoints: [endpoint()] } as never, 'pablo');
    const orden = Object.keys(repo.calls);
    expect(orden.indexOf('markStaleByDepsHash')).toBeLessThan(orden.indexOf('replaceFlows'));
  });

  it('devuelve cuántos flujos quedaron desactualizados, que es lo que hace útil la recarga', async () => {
    const repo = repositoryDouble();
    repo.markStaleByDepsHash = () => Promise.resolve(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    const resultado = await new SystemFlowsImportService(
      repo as unknown as SystemFlowsRepository,
      repo as never,
      repo as never,
      repo as never,
    ).importEndpoints({ systemCode: 'ATLAS_BACKEND', declaredCount: 1, endpoints: [endpoint()] } as never, null);
    expect(resultado).toMatchObject({ stale: 7 });
  });
});

describe('SystemFlowsImportService · revisión humana', () => {
  const analisisIncierto = {
    status: 'PARTIAL',
    chain: [],
    reads: [],
    writes: [{ table: 'loans', op: 'INSERT', via: 'SEQUELIZE' }],
    errors: [],
    blockCalls: [],
    events: [],
    unknowns: [{ reason: 'MAX_DEPTH', at: 'a.ts:1' }],
    transactional: false,
  };

  it('manda a revisión los flujos de riesgo alto con análisis incierto, y no los demás', async () => {
    const repo = repositoryDouble();
    const resultado = await new SystemFlowsImportService(
      repo as unknown as SystemFlowsRepository,
      repo as never,
      repo as never,
      repo as never,
    ).importEndpoints(
      {
        systemCode: 'ATLAS_BACKEND',
        declaredCount: 2,
        endpoints: [endpoint({ method: 'POST', path: 'loans', module: 'loans', analysis: analisisIncierto }), endpoint()],
      } as never,
      null,
    );
    expect(repo.calls.markForReview?.[0]?.[0]).toHaveLength(1);
    expect(resultado).toMatchObject({ needsReview: 1 });
  });

  it('reabre la revisión de lo que cambió: aprobar un flujo era aprobar ESE código', async () => {
    const repo = repositoryDouble();
    repo.markStaleByDepsHash = () => Promise.resolve(['flow_cambiado']);
    const resultado = await new SystemFlowsImportService(
      repo as unknown as SystemFlowsRepository,
      repo as never,
      repo as never,
      repo as never,
    ).importEndpoints({ systemCode: 'ATLAS_BACKEND', declaredCount: 1, endpoints: [endpoint()] } as never, null);
    expect(repo.calls.reopen?.[0]?.[0]).toEqual(['flow_cambiado']);
    expect(resultado).toMatchObject({ stale: 1, reopenedReviews: 1 });
  });
});

describe('SystemFlowsImportService · lo que una recarga no debe borrar', () => {
  it('una carga vacía no retira el catálogo de un bloque que tiene flujos: se rechaza', async () => {
    const repo = repositoryDouble();
    repo.catalogSize = () => Promise.resolve(498);
    await expect(
      new SystemFlowsImportService(repo as unknown as SystemFlowsRepository, repo as never, repo as never, repo as never).importEndpoints(
        { systemCode: 'ATLAS_BACKEND', declaredCount: 0, endpoints: [] } as never,
        null,
      ),
    ).rejects.toThrow(/se borrarían todos/);
    expect(repo.calls.replaceFlows).toBeUndefined();
  });

  it('dice cuántas decisiones humanas se pierden con los flujos que ya no vienen', async () => {
    const repo = repositoryDouble();
    repo.decisionsToBeRemoved = () => Promise.resolve(2);
    const resultado = await new SystemFlowsImportService(
      repo as unknown as SystemFlowsRepository,
      repo as never,
      repo as never,
      repo as never,
    ).importEndpoints(
      { systemCode: 'ATLAS_BACKEND', declaredCount: 1, endpoints: [endpoint()], allowRemovingDecisions: true } as never,
      null,
    );
    expect(resultado).toMatchObject({ removedDecisions: 2 });
  });

  it('suelta de la cola lo que se queda sin motivo', async () => {
    const repo = repositoryDouble();
    await new SystemFlowsImportService(
      repo as unknown as SystemFlowsRepository,
      repo as never,
      repo as never,
      repo as never,
    ).importEndpoints({ systemCode: 'ATLAS_BACKEND', declaredCount: 1, endpoints: [endpoint()] } as never, null);
    expect(repo.calls.release?.[0]?.[0]).toHaveLength(1);
  });
});

describe('SystemFlowsImportService · cargas que borrarían evidencia', () => {
  const servicioCon = (repo: RepoDouble) =>
    new SystemFlowsImportService(repo as unknown as SystemFlowsRepository, repo as never, repo as never, repo as never);

  it('una carga que retira flujos con decisión humana se para, salvo confirmación explícita', async () => {
    const repo = repositoryDouble();
    repo.decisionsToBeRemoved = () => Promise.resolve(3);
    await expect(
      servicioCon(repo).importEndpoints({ systemCode: 'ATLAS_BACKEND', declaredCount: 1, endpoints: [endpoint()] } as never, null),
    ).rejects.toThrow(/allowRemovingDecisions/);
    await expect(
      servicioCon(repo).importEndpoints(
        { systemCode: 'ATLAS_BACKEND', declaredCount: 1, endpoints: [endpoint()], allowRemovingDecisions: true } as never,
        null,
      ),
    ).resolves.toMatchObject({ removedDecisions: 3 });
  });

  it('una carga sin hallazgos de un bloque con hallazgos abiertos se rechaza: no se resuelven solos', async () => {
    const repo = repositoryDouble();
    repo.openFindingsOfSystem = () => Promise.resolve(10);
    await expect(
      servicioCon(repo).importFindings({ systemCode: 'ATLAS_BACKEND', declaredCount: 0, findings: [] } as never, null),
    ).rejects.toThrow(/se darían todos por resueltos/);
    expect(repo.calls.replaceFindings).toBeUndefined();
  });

  it('una carga truncada se para antes de escribir: lo que falta se daría por retirado o por resuelto', async () => {
    const repo = repositoryDouble();
    await expect(
      servicioCon(repo).importEndpoints({ systemCode: 'ATLAS_BACKEND', declaredCount: 499, endpoints: [endpoint()] } as never, null),
    ).rejects.toThrow(/trae 1 fila\(s\) y su artefacto declara 499/);
    const hallazgo = { kind: 'k', severity: 'LOW', systemCode: 'ATLAS_BACKEND', ref: 'r', summary: 's' };
    await expect(
      servicioCon(repo).importFindings({ systemCode: 'ATLAS_BACKEND', declaredCount: 401, findings: [hallazgo] } as never, null),
    ).rejects.toThrow(/está truncada/);
    await expect(
      servicioCon(repo).importScreens({ clientCode: 'MOTOR_PORTAL', declaredCount: 55, screens: [] } as never, null),
    ).rejects.toThrow(/está truncada/);
    expect(repo.calls.replaceFlows).toBeUndefined();
    expect(repo.calls.replaceFindings).toBeUndefined();
    expect(repo.calls.replaceScreens).toBeUndefined();
  });

  it('un artefacto sin puertas de menú no borra las que tiene el catálogo, salvo confirmación', async () => {
    const repo = repositoryDouble();
    repo.gatedScreensOfClient = () => Promise.resolve(30);
    const sinPuertas = { clientCode: 'MOTOR_PORTAL', declaredCount: 1, screens: [{ route: '/workers', navPermissions: [], navRoles: [] }] };
    await expect(servicioCon(repo).importScreens(sinPuertas as never, null)).rejects.toThrow(/allowRemovingMenuGates/);
    expect(repo.calls.replaceScreens).toBeUndefined();
    const conPuerta = { ...sinPuertas, screens: [{ route: '/workers', navPermissions: [], navRoles: ['ADMIN'] }] };
    await expect(servicioCon(repo).importScreens(conPuerta as never, null)).resolves.toMatchObject({ upserted: 1 });
    await expect(servicioCon(repo).importScreens({ ...sinPuertas, allowRemovingMenuGates: true } as never, null)).resolves.toMatchObject({
      upserted: 1,
    });
  });

  it('el contrato exige cuántas filas declara el artefacto, y no acepta una puerta de menú sin resolver', () => {
    expect(importEndpointsSchema.safeParse({ systemCode: 'ATLAS_BACKEND', endpoints: [] }).success).toBe(false);
    const pantalla = (navRoles: string[]) => ({ clientCode: 'MOTOR_PORTAL', declaredCount: 1, screens: [{ route: '/x', navRoles }] });
    expect(importScreensSchema.safeParse(pantalla(['ADMIN'])).success).toBe(true);
    expect(importScreensSchema.safeParse(pantalla(['<unresolved:accessPolicies.workers>'])).success).toBe(false);
  });
});
