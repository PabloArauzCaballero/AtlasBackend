import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { SystemsTestQueryService } from '../../../src/modules/systems-ops/systems-test-query.service.js';

/**
 * `SystemsTestQueryService` es la cara de lectura del catálogo de test-suites/runs de systems-ops:
 * mapea filas del repo a DTOs, aplica el scope de tenant en los runs y delega la ejecución en el
 * runner. Spec directo con repo y runner mockeados (los mappers reales transforman las filas).
 */
describe('SystemsTestQueryService', () => {
  function build() {
    const testRepository = {
      listTestSuites: jest.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[], meta: {} })),
      findTestSuiteById: jest.fn(async (..._args: unknown[]) => null),
      findTestStepsBySuite: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      listTestRuns: jest.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[], meta: {} })),
      findTestRunById: jest.fn(async (..._args: unknown[]) => null),
      findStepRunsByRun: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
    };
    const testRunner = { runSuite: jest.fn(async (..._args: unknown[]) => ({ ran: true })) };
    const service = new SystemsTestQueryService(testRepository as never, testRunner as never);
    return { service, testRepository, testRunner };
  }

  const user = { role: 'internal_operator', tenantId: 't1', internalUserId: 'u1' } as never;
  const suiteRow = { id: 7, code: 'SUITE_A', name: 'Suite A', module: 'auth', isEnabled: true };
  const runRow = { id: 3, suiteId: 7, status: 'passed' };

  it('listTestSuites mapea las filas a DTO y propaga el meta', async () => {
    const { service, testRepository } = build();
    (testRepository.listTestSuites as jest.Mock).mockResolvedValueOnce({ rows: [suiteRow], meta: { page: 1, total: 1 } } as never);
    const res = await service.listTestSuites({} as never);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ suiteId: '7', code: 'SUITE_A' });
    expect(res.meta).toEqual({ page: 1, total: 1 });
  });

  it('getTestSuite lanza NotFound cuando la suite no existe', async () => {
    const { service } = build();
    await expect(service.getTestSuite('7')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getTestSuite devuelve la suite con sus steps', async () => {
    const { service, testRepository } = build();
    (testRepository.findTestSuiteById as jest.Mock).mockResolvedValueOnce(suiteRow as never);
    (testRepository.findTestStepsBySuite as jest.Mock).mockResolvedValueOnce([{ id: 1, suiteId: 7, stepOrder: 1, name: 'step' }] as never);
    const res = await service.getTestSuite('7');
    expect(res.suite).toMatchObject({ suiteId: '7' });
    expect(res.steps).toHaveLength(1);
  });

  it('runTestSuite delega en el runner con suite, body y usuario', async () => {
    const { service, testRunner } = build();
    await service.runTestSuite('7', { environment: 'test' } as never, user);
    expect(testRunner.runSuite).toHaveBeenCalledWith('7', { environment: 'test' }, user);
  });

  it('listTestRuns aplica el scope de tenant del usuario y mapea', async () => {
    const { service, testRepository } = build();
    (testRepository.listTestRuns as jest.Mock).mockResolvedValueOnce({ rows: [runRow], meta: { page: 1 } } as never);
    const res = await service.listTestRuns({} as never, user);
    expect(testRepository.listTestRuns).toHaveBeenCalledWith({}, 't1');
    expect(res.items[0]).toMatchObject({ runId: '3', suiteId: '7' });
  });

  it('getTestRun lanza NotFound cuando el run no existe', async () => {
    const { service } = build();
    await expect(service.getTestRun('3', user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getTestRun devuelve el run con sus step-runs', async () => {
    const { service, testRepository } = build();
    (testRepository.findTestRunById as jest.Mock).mockResolvedValueOnce(runRow as never);
    (testRepository.findStepRunsByRun as jest.Mock).mockResolvedValueOnce([{ id: 9, testRunId: 3, stepId: 1, status: 'passed' }] as never);
    const res = await service.getTestRun('3', user);
    expect(res.run).toMatchObject({ runId: '3' });
    expect(res.steps).toHaveLength(1);
  });
});
