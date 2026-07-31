import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SystemsTestRunnerService } from '../../../src/modules/systems-ops/systems-test-runner.service.js';
import { SystemsTestAssertionService } from '../../../src/modules/systems-ops/systems-test-assertion.service.js';
import { SystemsTestTemplateService } from '../../../src/modules/systems-ops/systems-test-template.service.js';

/**
 * `SystemsTestRunnerService.runSuite` orquesta la ejecución de una suite de test. Este spec cubre las
 * GUARDAS de seguridad (NotFound, deshabilitada, entorno no permitido, bloqueo en producción, sin
 * pasos / demasiados pasos), el camino DRY-RUN (sin HTTP externo) y la lógica de skip tras un fallo.
 * Se inyectan los servicios puros reales (templates/assertions) y se mockean repo + httpClient.
 */
describe('SystemsTestRunnerService.runSuite', () => {
  function step(over: Record<string, unknown> = {}) {
    return {
      id: 1,
      stepOrder: 1,
      name: 'step1',
      method: 'GET',
      pathTemplate: '/x',
      defaultHeaders: {},
      defaultPayload: {},
      configSchema: {},
      extractors: {},
      assertions: {},
      inputMode: 'STATIC',
      continueOnFailure: false,
      ...over,
    };
  }

  function build(suite: unknown, steps: unknown[]) {
    const repository = {
      findTestSuiteById: jest.fn(async () => suite),
      findTestStepsBySuite: jest.fn(async () => steps),
      createTestRun: jest.fn(async () => ({ id: 'run1', suiteId: 1 })),
      createTestStepRun: asyncMock(),
      finishTestRun: jest.fn(async (_run: unknown, patch: { status: string }) => ({ id: 'run1', suiteId: 1, status: patch.status })),
      findStepRunsByRun: jest.fn(async () => [{ id: 1, testRunId: 'run1', stepId: '1', status: 'PASSED' }]),
    };
    const httpClient = { execute: asyncMock() };
    const service = new SystemsTestRunnerService(
      repository as never,
      new SystemsTestAssertionService(),
      httpClient as never,
      new SystemsTestTemplateService(),
    );
    return { service, repository, httpClient };
  }

  const user = { role: 'system_admin', tenantId: 't1', internalUserId: 'u1', platformUserId: null } as never;
  const dryBody = { environment: 'TEST', dryRun: true, config: {}, headers: {}, timeoutMs: 5000 } as never;
  const enabledSuite = (over: Record<string, unknown> = {}) => ({
    id: 1,
    isEnabled: true,
    environmentScope: ['TEST'],
    isSafeForProduction: false,
    ...over,
  });

  it('lanza NotFound si la suite no existe', async () => {
    const { service } = build(null, []);
    await expect(service.runSuite('1', dryBody, user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lanza BadRequest si la suite está deshabilitada', async () => {
    const { service } = build(enabledSuite({ isEnabled: false }), []);
    await expect(service.runSuite('1', dryBody, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lanza Forbidden si el entorno no está en el scope de la suite', async () => {
    const { service } = build(enabledSuite({ environmentScope: ['STAGING'] }), [step()]);
    await expect(service.runSuite('1', dryBody, user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('bloquea la ejecución en PRODUCTION_READONLY sobre una suite no segura', async () => {
    const { service } = build(enabledSuite({ environmentScope: ['PRODUCTION_READONLY'], isSafeForProduction: false }), [step()]);
    await expect(
      service.runSuite('1', { ...(dryBody as object), environment: 'PRODUCTION_READONLY' } as never, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lanza BadRequest si la suite no tiene pasos o excede el máximo', async () => {
    const noSteps = build(enabledSuite(), []);
    await expect(noSteps.service.runSuite('1', dryBody, user)).rejects.toBeInstanceOf(BadRequestException);

    const tooMany = build(
      enabledSuite(),
      Array.from({ length: 51 }, (_, i) => step({ id: i, stepOrder: i })),
    );
    await expect(tooMany.service.runSuite('1', dryBody, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('DRY-RUN ejecuta los pasos sin HTTP externo y finaliza en PASSED', async () => {
    const { service, repository, httpClient } = build(enabledSuite(), [step()]);
    const res = await service.runSuite('1', dryBody, user);
    expect(httpClient.execute).not.toHaveBeenCalled();
    expect(res.run).toBeDefined();
    const [, patch] = repository.finishTestRun.mock.calls[0] as unknown as [
      unknown,
      { status: string; summary: { passed: number; failed: number } },
    ];
    expect(patch.status).toBe('PASSED');
    expect(patch.summary).toMatchObject({ passed: 1, failed: 0 });
  });

  it('un paso que falla con continueOnFailure=false salta los siguientes (SKIPPED) y el run queda FAILED', async () => {
    const steps = [
      step({ id: 1, stepOrder: 1, pathTemplate: '{{ bad.x }}' }), // scope inválido -> resolveString lanza -> paso FAILED
      step({ id: 2, stepOrder: 2, name: 'step2', pathTemplate: '/y' }),
    ];
    const { service, repository } = build(enabledSuite(), steps);
    await service.runSuite('1', dryBody, user);
    const [, patch] = repository.finishTestRun.mock.calls[0] as unknown as [
      unknown,
      { status: string; summary: { failed: number; skipped: number } },
    ];
    expect(patch.status).toBe('FAILED');
    expect(patch.summary).toMatchObject({ failed: 1, skipped: 1 });
    const statuses = repository.createTestStepRun.mock.calls.map((call) => (call[0] as unknown as { status: string }).status);
    expect(statuses).toContain('SKIPPED');
  });
});
