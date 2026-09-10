import { NotFoundException } from '@nestjs/common';
import { SystemFlowsImportService } from '../../src/modules/systems-ops/system-flows.import.service.js';
import { SystemFlowsService } from '../../src/modules/systems-ops/system-flows.service.js';
import type { SystemFlowsRepository } from '../../src/modules/systems-ops/system-flows.repository.js';

/**
 * Reglas del servicio de Flujos que se romperían en silencio: ningún tipo las protege y las
 * pruebas puras (riesgo, grafo, verificación) no las tocan porque viven en la coordinación.
 */
type RepoDouble = {
  calls: Record<string, unknown[][]>;
  runs: Map<string, unknown>;
  flows: Array<Record<string, unknown>>;
} & Record<string, unknown>;

function repositoryDouble(over: Partial<{ runs: Map<string, unknown>; flows: Array<Record<string, unknown>> }> = {}): RepoDouble {
  const calls: Record<string, unknown[][]> = {};
  const spy =
    (name: string, result?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return Promise.resolve(result);
    };
  const double: Record<string, unknown> = {
    calls,
    runs: over.runs ?? new Map(),
    flows: over.flows ?? [],
    transaction: (work: (tx: unknown) => Promise<unknown>) => work('tx'),
    runsByRoute: (...args: unknown[]) => {
      (calls.runsByRoute ??= []).push(args);
      return Promise.resolve(over.runs ?? new Map());
    },
    flowsOfSystem: (...args: unknown[]) => {
      (calls.flowsOfSystem ??= []).push(args);
      return Promise.resolve(over.flows ?? []);
    },
    applyVerification: spy('applyVerification'),
    applyFreshness: spy('applyFreshness'),
    createImport: (...args: unknown[]) => {
      (calls.createImport ??= []).push(args);
      return Promise.resolve({ id: '7', update: spy('importUpdate') });
    },
    replaceFindings: (...args: unknown[]) => {
      (calls.replaceFindings ??= []).push(args);
      return Promise.resolve({ upserted: (args[1] as unknown[]).length, removed: 0 });
    },
    recountFindings: spy('recountFindings'),
    findFlow: spy('findFlow', null),
    findFlowsByModule: spy('findFlowsByModule', []),
  };
  return double as RepoDouble;
}

/** El servicio pide una federación y un importador; ninguna prueba de aquí los ejercita. */
const federationDouble = (result?: unknown, pedidas?: string[]) =>
  ({
    fetchFromBlock: async (_code: string, _token: string | null, path?: string) => {
      if (path) pedidas?.push(path);
      return result ?? { ok: false, status: 'NOT_CONFIGURED', message: 'no aplica' };
    },
  }) as never;
const importDouble = (repo: unknown) => new SystemFlowsImportService(repo as never);

const flow = (over: Record<string, unknown> = {}) => ({
  flowId: 'flow_000000000001',
  httpMethod: 'GET',
  path: 'systems/flows',
  analyzedCommit: null,
  freshness: 'FRESH',
  ...over,
});
const runs = (ok: number, failed: number) => ({
  ok,
  failed,
  lastAt: new Date(),
  lastStatus: ok ? 200 : 500,
  statuses: {},
  correlationSample: [],
});

describe('SystemFlowsService.verify', () => {
  it('verifica sólo lo que tiene corridas y deja el resto intacto: no verificado no es roto', async () => {
    const repo = repositoryDouble({
      runs: new Map([['GET systems/flows', runs(3, 0)]]),
      flows: [flow(), flow({ flowId: 'flow_000000000002', path: 'systems/flows/screens' })],
    });
    const result = await new SystemFlowsService(repo as unknown as SystemFlowsRepository, federationDouble(), importDouble(repo)).verify(
      { systemCode: 'ATLAS_BACKEND', windowDays: 30 },
      'pablo',
    );
    expect(result).toMatchObject({ verified: 1, broken: 0, unverified: 1, routesWithRuns: 1 });
    expect(repo.calls.applyVerification).toHaveLength(1);
    expect(repo.calls.applyVerification?.[0]?.[0]).toBe('flow_000000000001');
  });

  it('sólo 5xx en la ventana marca BROKEN', async () => {
    const repo = repositoryDouble({ runs: new Map([['GET systems/flows', runs(0, 4)]]), flows: [flow()] });
    const result = await new SystemFlowsService(repo as unknown as SystemFlowsRepository, federationDouble(), importDouble(repo)).verify(
      { systemCode: 'ATLAS_BACKEND', windowDays: 7 },
      null,
    );
    expect(result).toMatchObject({ verified: 0, broken: 1 });
    expect((repo.calls.applyVerification?.[0]?.[1] as { verification: string }).verification).toBe('BROKEN');
  });

  it('un bloque que no escribe en system_action_logs no se consulta ni se marca: se declara saltado', async () => {
    const repo = repositoryDouble({ flows: [flow(), flow({ flowId: 'flow_000000000002' })] });
    const result = await new SystemFlowsService(repo as unknown as SystemFlowsRepository, federationDouble(), importDouble(repo)).verify(
      { systemCode: 'ERP_BACKEND', windowDays: 30 },
      null,
    );
    expect(result).toMatchObject({ systemCode: 'ERP_BACKEND', skippedNoLogs: 2, verified: 0, broken: 0, routesWithRuns: 0 });
    expect(repo.calls.runsByRoute).toBeUndefined();
    expect(repo.calls.applyVerification).toBeUndefined();
  });

  it('la ventana llega tal cual al repositorio: verificar con 7 días no puede consultar 30', async () => {
    const repo = repositoryDouble({ flows: [] });
    await new SystemFlowsService(repo as unknown as SystemFlowsRepository, federationDouble(), importDouble(repo)).verify(
      { systemCode: 'ATLAS_BACKEND', windowDays: 7 },
      null,
    );
    expect(repo.calls.runsByRoute?.[0]?.[0]).toBe(7);
  });

  it('no reescribe la frescura cuando ya coincide: una corrida sin cambios no ensucia updated_at', async () => {
    const repo = repositoryDouble({ runs: new Map(), flows: [flow({ analyzedCommit: 'abc1234', freshness: 'FRESH' })] });
    const anterior = process.env.APP_COMMIT_SHA;
    process.env.APP_COMMIT_SHA = 'abc1234';
    try {
      await new SystemFlowsService(repo as unknown as SystemFlowsRepository, federationDouble(), importDouble(repo)).verify(
        { systemCode: 'ATLAS_BACKEND', windowDays: 30 },
        null,
      );
    } finally {
      if (anterior === undefined) delete process.env.APP_COMMIT_SHA;
      else process.env.APP_COMMIT_SHA = anterior;
    }
    expect(repo.calls.applyFreshness).toBeUndefined();
  });
});

describe('SystemFlowsImportService.importFindings', () => {
  it('ignora los hallazgos de otro bloque: cargar el ERP no puede tocar las filas del Backend', async () => {
    const repo = repositoryDouble();
    const result = await new SystemFlowsImportService(repo as unknown as SystemFlowsRepository).importFindings(
      {
        systemCode: 'ERP_BACKEND',
        findings: [
          { kind: 'CONTRACT_DRIFT', severity: 'HIGH', systemCode: 'ERP_BACKEND', ref: 'POST auth/login', summary: 'x' },
          { kind: 'CONTRACT_DRIFT', severity: 'HIGH', systemCode: 'ATLAS_BACKEND', ref: 'POST auth/login', summary: 'x' },
        ],
      },
      'pablo',
    );
    expect(result).toMatchObject({ upserted: 1, ignored: 1 });
    expect(repo.calls.replaceFindings?.[0]?.[0]).toBe('ERP_BACKEND');
  });

  it('recuenta los hallazgos por flujo tras cargar: el contador de la tabla no puede quedar viejo', async () => {
    const repo = repositoryDouble();
    await new SystemFlowsImportService(repo as unknown as SystemFlowsRepository).importFindings(
      { systemCode: 'ATLAS_BACKEND', findings: [] },
      null,
    );
    expect(repo.calls.recountFindings?.[0]?.[0]).toBe('ATLAS_BACKEND');
  });
});

describe('SystemFlowsService.getFlow', () => {
  it('un flujo que no existe es 404, no una ficha vacía', async () => {
    const repo = repositoryDouble();
    await expect(
      new SystemFlowsService(repo as unknown as SystemFlowsRepository, federationDouble(), importDouble(repo)).getFlow('flow_000000000009'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un módulo sin flujos es 404, no un grafo de cero nodos', async () => {
    const repo = repositoryDouble();
    await expect(
      new SystemFlowsService(repo as unknown as SystemFlowsRepository, federationDouble(), importDouble(repo)).getModuleGraph({
        systemCode: 'ATLAS_BACKEND',
        module: 'inexistente',
        includeRoles: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SystemFlowsService.verify · bloques federados', () => {
  const flowDelMotor = {
    flowId: 'flow_000000000009',
    httpMethod: 'POST',
    path: 'v1/decisions/:p',
    controller: 'DecisionsController',
    handler: 'run',
    analyzedCommit: null,
    freshness: 'FRESH',
  };

  it('verifica el Motor cruzando por controller y handler, que es lo que su auditoría registra', async () => {
    const repo = repositoryDouble({ flows: [flowDelMotor] });
    const federacion = federationDouble({
      ok: true,
      body: { resources: [{ resource: 'POST DecisionsController.run', decision: 'ALLOW', count: 4, lastAt: '2026-09-09T10:00:00Z' }] },
    });
    const service = new SystemFlowsService(repo as unknown as SystemFlowsRepository, federacion, importDouble(repo));
    const result = await service.verify({ systemCode: 'DECISION_ENGINE', windowDays: 30 }, 'pablo', 'token');
    expect(result).toMatchObject({ verified: 1, broken: 0, skippedNoLogs: 0, federation: { ok: true } });
    // La evidencia dice de dónde salió: nadie debe creer que esto vino de system_action_logs.
    expect((repo.calls.applyVerification?.[0]?.[1] as { evidence: { source: string } }).evidence.source).toContain('decision_access_audit');
  });

  const evidenciaDe = (repo: { calls: Record<string, unknown[][]> }) =>
    (repo.calls.applyVerification?.[0]?.[1] as { evidence: { statuses: Record<string, number>; lastStatus: number | null } }).evidence;

  it('un DENY con 5xx sí marca BROKEN', async () => {
    const repo = repositoryDouble({ flows: [flowDelMotor] });
    const federacion = federationDouble({
      ok: true,
      body: { resources: [{ resource: 'POST DecisionsController.run', decision: 'DENY', status: 500, count: 2, lastAt: null }] },
    });
    const service = new SystemFlowsService(repo as unknown as SystemFlowsRepository, federacion, importDouble(repo));
    const result = await service.verify({ systemCode: 'DECISION_ENGINE', windowDays: 30 }, null, 'token');
    expect(result).toMatchObject({ verified: 0, broken: 1 });
    expect(evidenciaDe(repo).statuses).toMatchObject({ 'DENY 500': 2 });
  });

  it('un DENY con 4xx NO es estar roto: el flujo rechazó, que es su trabajo', async () => {
    // Medido el 2026-09-10 contra el Motor: un DENY con motivo «Version is not fully approved»
    // —una regla de negocio haciendo lo suyo— marcaba BROKEN el despliegue de versiones.
    const repo = repositoryDouble({ flows: [flowDelMotor] });
    const federacion = federationDouble({
      ok: true,
      body: { resources: [{ resource: 'POST DecisionsController.run', decision: 'DENY', status: 400, count: 3, lastAt: null }] },
    });
    const service = new SystemFlowsService(repo as unknown as SystemFlowsRepository, federacion, importDouble(repo));
    const result = await service.verify({ systemCode: 'DECISION_ENGINE', windowDays: 30 }, null, 'token');
    expect(result).toMatchObject({ verified: 1, broken: 0 });
    expect(evidenciaDe(repo).statuses).toMatchObject({ 'DENY 400': 3 });
    expect(evidenciaDe(repo).lastStatus).toBe(400);
  });

  it('un DENY SIN código es de antes de que el Motor lo guardara: cuenta como corrida y se deja a la vista', async () => {
    const repo = repositoryDouble({ flows: [flowDelMotor] });
    const federacion = federationDouble({
      ok: true,
      body: { resources: [{ resource: 'POST DecisionsController.run', decision: 'DENY', count: 2, lastAt: null }] },
    });
    const service = new SystemFlowsService(repo as unknown as SystemFlowsRepository, federacion, importDouble(repo));
    const result = await service.verify({ systemCode: 'DECISION_ENGINE', windowDays: 30 }, null, 'token');
    expect(result).toMatchObject({ verified: 1, broken: 0 });
    // No se inventa un código: el DENY queda desnudo en la evidencia y `lastStatus` sigue nulo.
    expect(evidenciaDe(repo).statuses).toMatchObject({ DENY: 2 });
    expect(evidenciaDe(repo).lastStatus).toBeNull();
  });

  it('si el bloque no se puede alcanzar, sus flujos quedan saltados y se dice por qué', async () => {
    const repo = repositoryDouble({ flows: [flowDelMotor, { ...flowDelMotor, flowId: 'flow_000000000010' }] });
    const service = new SystemFlowsService(repo as unknown as SystemFlowsRepository, federationDouble(), importDouble(repo));
    const result = await service.verify({ systemCode: 'DECISION_ENGINE', windowDays: 30 }, null, null);
    expect(result).toMatchObject({ skippedNoLogs: 2, verified: 0, broken: 0, federation: { ok: false } });
    expect(repo.calls.applyVerification).toBeUndefined();
  });

  it('el ERP se cruza por ruta y código HTTP, que es lo que él sí registra', async () => {
    const flowDelErp = {
      flowId: 'flow_000000000011',
      httpMethod: 'GET',
      path: 'accounting/ar-invoices/:p',
      controller: 'ArInvoicesController',
      handler: 'find',
      analyzedCommit: null,
      freshness: 'FRESH',
    };
    const repo = repositoryDouble({ flows: [flowDelErp] });
    const federacion = federationDouble({
      ok: true,
      // El ERP publica la plantilla con prefijo y barra inicial: se normaliza al formato del catálogo.
      body: {
        entries: [
          {
            method: 'GET',
            path: '/api/v1/accounting/ar-invoices/:id',
            ok: 5,
            failed: 0,
            lastStatus: 200,
            lastAt: '2026-09-10T00:00:00Z',
            statuses: { '200': 5 },
          },
        ],
      },
    });
    const service = new SystemFlowsService(repo as unknown as SystemFlowsRepository, federacion, importDouble(repo));
    const result = await service.verify({ systemCode: 'ERP_BACKEND', windowDays: 30 }, null, 'token');
    expect(result).toMatchObject({ verified: 1, broken: 0, skippedNoLogs: 0 });
    expect((repo.calls.applyVerification?.[0]?.[1] as { evidence: { lastStatus: number } }).evidence.lastStatus).toBe(200);
  });

  it.each([
    ['DECISION_ENGINE', '/v1/audit/access-runs?windowDays=30'],
    ['ERP_BACKEND', '/api/v1/platform/access-runs'],
    ['DASHBOARDS', '/api/v1/platform/access-runs'],
  ])('a %s se le pide la evidencia en la ruta que declara su configuración, no en una clavada', async (systemCode, esperada) => {
    // El prefijo de la API de cada bloque es SUYO y está parametrizado en el entorno justamente
    // porque puede cambiar sin que este repo se entere. Pedirla sin prefijo devolvía 404, que se
    // leería como «este bloque no registra nada» en vez de como «se pidió la ruta equivocada».
    const pedidas: string[] = [];
    const repo = repositoryDouble({ flows: [] });
    const service = new SystemFlowsService(
      repo as unknown as SystemFlowsRepository,
      federationDouble({ ok: true, body: {} }, pedidas),
      importDouble(repo),
    );
    await service.verify({ systemCode, windowDays: 30 }, null, 'token');
    expect(pedidas).toEqual([esperada]);
  });

  it('un bloque que no publica evidencia no se intenta federar siquiera', async () => {
    // Hoy los cuatro backends del catálogo publican la suya, así que el caso se prueba con un
    // código que no está en `ACCESS_EVIDENCE`: es lo que pasaría con un bloque nuevo antes de
    // enseñarle a publicar. Lo importante es que no se inventa una corrida ni se llama roto a nada.
    const repo = repositoryDouble({ flows: [flowDelMotor] });
    const pedidas: string[] = [];
    const service = new SystemFlowsService(
      repo as unknown as SystemFlowsRepository,
      federationDouble({ ok: true, body: { resources: [] } }, pedidas),
      importDouble(repo),
    );
    const result = await service.verify({ systemCode: 'BLOQUE_NUEVO', windowDays: 30 }, null, 'token');
    expect(result).toMatchObject({ skippedNoLogs: 1, verified: 0, broken: 0 });
    expect((result as { federation?: { message?: string } }).federation?.message).toContain('no publica evidencia');
    expect(pedidas).toEqual([]);
  });
});

describe('SystemFlowsService · delegación de consultas', () => {
  /**
   * Los métodos de consulta son de una línea, y precisamente por eso un cruce entre dos que
   * devuelven listas parecidas —pantallas y hallazgos, por ejemplo— compila, responde 200 y
   * enseña los datos equivocados sin un solo error. Se comprueba que cada uno llama al suyo.
   */
  it.each([
    ['listFlows', 'listFlows', { page: 1, limit: 20 }],
    ['listScreens', 'listScreens', { page: 1, limit: 20 }],
    ['listFindings', 'listFindings', { page: 1, limit: 20 }],
  ])('%s pasa su consulta al repositorio', async (metodo, esperado, query) => {
    const repo = repositoryDouble();
    repo[esperado] = (...args: unknown[]) => {
      (repo.calls[esperado] ??= []).push(args);
      return Promise.resolve({ rows: [], meta: {} });
    };
    const service = new SystemFlowsService(repo as unknown as SystemFlowsRepository, federationDouble(), importDouble(repo));
    await (service as unknown as Record<string, (q: unknown) => Promise<unknown>>)[metodo](query);
    expect(repo.calls[esperado]?.[0]?.[0]).toBe(query);
  });

  it.each(['summary', 'modules'])('%s delega sin transformar', (metodo) => {
    const repo = repositoryDouble();
    repo[metodo] = (...args: unknown[]) => {
      (repo.calls[metodo] ??= []).push(args);
      return Promise.resolve({ ok: true });
    };
    const service = new SystemFlowsService(repo as unknown as SystemFlowsRepository, federationDouble(), importDouble(repo));
    void (service as unknown as Record<string, () => unknown>)[metodo]();
    expect(repo.calls[metodo]).toHaveLength(1);
  });

  it('imports devuelve las cargas con su commit y quién las hizo, no el modelo crudo', async () => {
    const repo = repositoryDouble();
    repo.latestImports = () =>
      Promise.resolve([
        {
          id: '3',
          scope: 'endpoints',
          systemCode: 'ATLAS_BACKEND',
          analyzedCommit: 'abc1234',
          analyzedBranch: 'dev',
          contentHash: 'h',
          rowsReceived: 10,
          rowsUpserted: 10,
          rowsRemoved: 0,
          createdBy: 'pablo',
          createdAtValue: new Date('2026-09-09T00:00:00Z'),
        },
      ]);
    const service = new SystemFlowsService(repo as unknown as SystemFlowsRepository, federationDouble(), importDouble(repo));
    const result = await service.imports();
    expect(result[0]).toMatchObject({ id: '3', analyzedCommit: 'abc1234', createdBy: 'pablo' });
    expect(result[0]).toHaveProperty('createdAt');
    expect(result[0]).not.toHaveProperty('createdAtValue');
  });

  it('businessFlows agrupa los pasos por proceso y cuenta los que no enlazan con un flujo', async () => {
    const repo = repositoryDouble();
    repo.businessFlows = () =>
      Promise.resolve([
        {
          workflow_code: 'alta',
          workflow_name: 'Alta',
          version: 'v1',
          stage_code: 'A',
          step_code: 's1',
          step_name: 'Uno',
          execution_order: 1,
          http_method: 'POST',
          route_path: '/x',
          is_mandatory: true,
          requires_auth: true,
          requires_idempotency_key: false,
          flow_id: 'flow_000000000001',
          risk: 'CRITICAL',
          verification: 'VERIFIED',
          test_status: 'TESTED',
          module: 'auth',
        },
        {
          workflow_code: 'alta',
          workflow_name: 'Alta',
          version: 'v1',
          stage_code: 'A',
          step_code: 's2',
          step_name: 'Dos',
          execution_order: 2,
          http_method: 'GET',
          route_path: '/y',
          is_mandatory: false,
          requires_auth: true,
          requires_idempotency_key: false,
          flow_id: null,
          risk: null,
          verification: null,
          test_status: null,
          module: null,
        },
      ]);
    const service = new SystemFlowsService(repo as unknown as SystemFlowsRepository, federationDouble(), importDouble(repo));
    const result = await service.businessFlows();
    expect(result.totals).toEqual({ processes: 1, steps: 2, unlinked: 1 });
    expect(result.processes[0]).toMatchObject({ workflowCode: 'alta', stepCount: 2, linked: 1, unlinked: 1, verified: 1, critical: 1 });
  });
});
