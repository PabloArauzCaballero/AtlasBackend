import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { Op } from 'sequelize';
import { SystemsTestExecutionRepository } from '../../../src/modules/systems-ops/systems-test-execution.repository.js';

/**
 * Cobertura directa de `SystemsTestExecutionRepository` (Fase 1.2 del plan 10/10): upserts de suite/
 * step con defaults, ciclo de vida de test runs (create/finish/step-run), listados con filtros y la
 * reconciliación de runs colgados (markStaleRunsFailed). Modelos Sequelize mockeados.
 */
describe('SystemsTestExecutionRepository', () => {
  function buildRepo() {
    const suiteModel = { upsert: asyncMock(), findAndCountAll: asyncMock(), findByPk: asyncMock() };
    const stepModel = { upsert: asyncMock(), findAll: asyncMock() };
    const runModel = { create: asyncMock(), findAndCountAll: asyncMock(), update: asyncMock(), findOne: asyncMock() };
    const stepRunModel = { create: asyncMock(), findAll: asyncMock() };
    const repo = new SystemsTestExecutionRepository(suiteModel as never, stepModel as never, runModel as never, stepRunModel as never);
    return { repo, suiteModel, stepModel, runModel, stepRunModel };
  }

  it('upsertTestSuite: isSafeForProduction=false ⇒ requiresDestructivePermission=true', async () => {
    const { repo, suiteModel } = buildRepo();
    (suiteModel.upsert as jest.Mock).mockResolvedValue([{ id: 's1' }] as never);
    await repo.upsertTestSuite({ code: 'C', name: 'N', description: 'D', module: 'm', suiteType: 't', environmentScope: ['dev'] });
    expect((suiteModel.upsert as jest.Mock).mock.calls[0][0]).toMatchObject({
      isSafeForProduction: false,
      requiresDestructivePermission: true,
      executionMode: 'SYNC_OR_JOB',
    });
  });

  it('upsertTestSuite: isSafeForProduction=true ⇒ requiresDestructivePermission=false', async () => {
    const { repo, suiteModel } = buildRepo();
    (suiteModel.upsert as jest.Mock).mockResolvedValue([{ id: 's1' }] as never);
    await repo.upsertTestSuite({
      code: 'C',
      name: 'N',
      description: 'D',
      module: 'm',
      suiteType: 't',
      environmentScope: ['prod'],
      isSafeForProduction: true,
    });
    expect((suiteModel.upsert as jest.Mock).mock.calls[0][0]).toMatchObject({
      isSafeForProduction: true,
      requiresDestructivePermission: false,
    });
  });

  it('upsertTestStep aplica defaults (inputMode DEFAULT, assertions con expectedStatusCodes)', async () => {
    const { repo, stepModel } = buildRepo();
    (stepModel.upsert as jest.Mock).mockResolvedValue([{}] as never);
    await repo.upsertTestStep({ suiteId: 's1', endpointId: null, stepOrder: 1, name: 'step', method: 'GET', pathTemplate: '/x' });
    expect((stepModel.upsert as jest.Mock).mock.calls[0][0]).toMatchObject({
      inputMode: 'DEFAULT',
      continueOnFailure: false,
      assertions: { expectedStatusCodes: [200, 201] },
    });
  });

  it('listTestSuites mapea filtros opcionales y calcula offset', async () => {
    const { repo, suiteModel } = buildRepo();
    (suiteModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
    await repo.listTestSuites({ module: 'm', enabled: true, page: 2, limit: 10 } as never);
    const arg = (suiteModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; offset: number };
    expect(arg.where).toMatchObject({ module: 'm', isEnabled: true });
    expect(arg.offset).toBe(10);
  });

  it('createTestRun nace sin finishedAt/durationMs y con timestamps de startedAt', async () => {
    const { repo, runModel } = buildRepo();
    (runModel.create as jest.Mock).mockResolvedValue({ id: 'r1' } as never);
    const startedAt = new Date('2026-01-20');
    await repo.createTestRun({
      tenantId: 't1',
      suiteId: 's1',
      environment: 'dev',
      triggeredBy: 'u1',
      status: 'RUNNING',
      startedAt,
      summary: {},
    });
    expect((runModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      finishedAt: null,
      durationMs: null,
      createdAtValue: startedAt,
    });
  });

  it('finishTestRun copia status/finishedAt/duration/summary y guarda', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({}));
    const run = { save } as never;
    const finishedAt = new Date('2026-01-21');
    await repo.finishTestRun(run, { status: 'PASSED', finishedAt, durationMs: 1234, summary: { ok: true } });
    expect((run as { status: string; durationMs: number }).status).toBe('PASSED');
    expect((run as { durationMs: number }).durationMs).toBe(1234);
    expect(save).toHaveBeenCalled();
  });

  it('listTestRuns reconcilia runs colgados antes de listar y aplica tenantId', async () => {
    const { repo, runModel } = buildRepo();
    (runModel.update as jest.Mock).mockResolvedValue([0] as never);
    (runModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
    await repo.listTestRuns({ status: 'PASSED', page: 1, limit: 20 } as never, 't1');
    expect(runModel.update).toHaveBeenCalled();
    expect(callArg<CallArgRecord>(runModel.findAndCountAll, 0, 0).where).toMatchObject({ status: 'PASSED', tenantId: 't1' });
  });

  it('markStaleRunsFailed marca RUNNING con startedAt anterior a 2h como FAILED', async () => {
    const { repo, runModel } = buildRepo();
    (runModel.update as jest.Mock).mockResolvedValue([3] as never);
    const count = await repo.markStaleRunsFailed(null);
    expect(count).toBe(3);
    const [values, opts] = (runModel.update as jest.Mock).mock.calls[0] as [Record<string, unknown>, { where: Record<string, unknown> }];
    expect(values.status).toBe('FAILED');
    expect(opts.where.status).toBe('RUNNING');
    expect((opts.where.startedAt as Record<symbol, unknown>)[Op.lt]).toBeInstanceOf(Date);
    expect(opts.where.tenantId).toBeUndefined();
  });

  it('findTestRunById sin tenantId no filtra por tenant', async () => {
    const { repo, runModel } = buildRepo();
    (runModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findTestRunById('r1', null);
    expect(callArg<CallArgRecord>(runModel.findOne, 0, 0).where).toEqual({ id: 'r1' });
  });

  it('findStepRunsByRun filtra por testRunId y ordena por id asc', async () => {
    const { repo, stepRunModel } = buildRepo();
    (stepRunModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findStepRunsByRun('r1');
    const arg = (stepRunModel.findAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; order: unknown };
    expect(arg.where).toEqual({ testRunId: 'r1' });
    expect(arg.order).toEqual([['id', 'ASC']]);
  });
});
