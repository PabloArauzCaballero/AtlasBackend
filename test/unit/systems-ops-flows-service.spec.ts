import { NotFoundException } from '@nestjs/common';
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
    const result = await new SystemFlowsService(repo as unknown as SystemFlowsRepository).verify(
      { systemCode: 'ATLAS_BACKEND', windowDays: 30 },
      'pablo',
    );
    expect(result).toMatchObject({ verified: 1, broken: 0, unverified: 1, routesWithRuns: 1 });
    expect(repo.calls.applyVerification).toHaveLength(1);
    expect(repo.calls.applyVerification?.[0]?.[0]).toBe('flow_000000000001');
  });

  it('sólo 5xx en la ventana marca BROKEN', async () => {
    const repo = repositoryDouble({ runs: new Map([['GET systems/flows', runs(0, 4)]]), flows: [flow()] });
    const result = await new SystemFlowsService(repo as unknown as SystemFlowsRepository).verify(
      { systemCode: 'ATLAS_BACKEND', windowDays: 7 },
      null,
    );
    expect(result).toMatchObject({ verified: 0, broken: 1 });
    expect((repo.calls.applyVerification?.[0]?.[1] as { verification: string }).verification).toBe('BROKEN');
  });

  it('un bloque que no escribe en system_action_logs no se consulta ni se marca: se declara saltado', async () => {
    const repo = repositoryDouble({ flows: [flow(), flow({ flowId: 'flow_000000000002' })] });
    const result = await new SystemFlowsService(repo as unknown as SystemFlowsRepository).verify(
      { systemCode: 'ERP_BACKEND', windowDays: 30 },
      null,
    );
    expect(result).toMatchObject({ systemCode: 'ERP_BACKEND', skippedNoLogs: 2, verified: 0, broken: 0, routesWithRuns: 0 });
    expect(repo.calls.runsByRoute).toBeUndefined();
    expect(repo.calls.applyVerification).toBeUndefined();
  });

  it('la ventana llega tal cual al repositorio: verificar con 7 días no puede consultar 30', async () => {
    const repo = repositoryDouble({ flows: [] });
    await new SystemFlowsService(repo as unknown as SystemFlowsRepository).verify({ systemCode: 'ATLAS_BACKEND', windowDays: 7 }, null);
    expect(repo.calls.runsByRoute?.[0]?.[0]).toBe(7);
  });

  it('no reescribe la frescura cuando ya coincide: una corrida sin cambios no ensucia updated_at', async () => {
    const repo = repositoryDouble({ runs: new Map(), flows: [flow({ analyzedCommit: 'abc1234', freshness: 'FRESH' })] });
    const anterior = process.env.APP_COMMIT_SHA;
    process.env.APP_COMMIT_SHA = 'abc1234';
    try {
      await new SystemFlowsService(repo as unknown as SystemFlowsRepository).verify({ systemCode: 'ATLAS_BACKEND', windowDays: 30 }, null);
    } finally {
      if (anterior === undefined) delete process.env.APP_COMMIT_SHA;
      else process.env.APP_COMMIT_SHA = anterior;
    }
    expect(repo.calls.applyFreshness).toBeUndefined();
  });
});

describe('SystemFlowsService.importFindings', () => {
  it('ignora los hallazgos de otro bloque: cargar el ERP no puede tocar las filas del Backend', async () => {
    const repo = repositoryDouble();
    const result = await new SystemFlowsService(repo as unknown as SystemFlowsRepository).importFindings(
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
    await new SystemFlowsService(repo as unknown as SystemFlowsRepository).importFindings(
      { systemCode: 'ATLAS_BACKEND', findings: [] },
      null,
    );
    expect(repo.calls.recountFindings?.[0]?.[0]).toBe('ATLAS_BACKEND');
  });
});

describe('SystemFlowsService.getFlow', () => {
  it('un flujo que no existe es 404, no una ficha vacía', async () => {
    const repo = repositoryDouble();
    await expect(new SystemFlowsService(repo as unknown as SystemFlowsRepository).getFlow('flow_000000000009')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('un módulo sin flujos es 404, no un grafo de cero nodos', async () => {
    const repo = repositoryDouble();
    await expect(
      new SystemFlowsService(repo as unknown as SystemFlowsRepository).getModuleGraph({
        systemCode: 'ATLAS_BACKEND',
        module: 'inexistente',
        includeRoles: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
