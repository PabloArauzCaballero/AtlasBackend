import { describe, expect, it, jest } from '@jest/globals';
import { SystemsTestController } from '../../../src/modules/systems-ops/systems-test.controller.js';

/**
 * `SystemsTestController` reparte entre `SystemsTestQueryService` (lecturas + ejecución) y
 * `SystemsTestSuiteAdminService` (CRUD de suites/steps). Spec directo que verifica ese ruteo.
 */
describe('SystemsTestController', () => {
  function build() {
    const service = {
      listTestSuites: jest.fn(async () => ({ items: [] })),
      getTestSuite: jest.fn(async () => ({ suite: {} })),
      runTestSuite: jest.fn(async () => ({ run: {} })),
      listTestRuns: jest.fn(async () => ({ items: [] })),
      getTestRun: jest.fn(async () => ({ run: {} })),
    };
    const suiteAdminService = {
      createSuite: jest.fn(async () => ({ suite: {} })),
      updateSuite: jest.fn(async () => ({ suite: {} })),
      createStep: jest.fn(async () => ({ stepId: '1' })),
      updateStep: jest.fn(async () => ({ stepId: '1' })),
      reorderSteps: jest.fn(async () => ({ items: [] })),
    };
    return { controller: new SystemsTestController(service as never, suiteAdminService as never), service, suiteAdminService };
  }
  const user = { role: 'qa_engineer', tenantId: '1', internalUserId: 'u1' } as never;

  it('las lecturas y la ejecución van a SystemsTestQueryService (con user donde aplica)', async () => {
    const { controller, service } = build();
    await controller.listTestSuites({ module: 'auth' } as never);
    await controller.getTestSuite({ suiteId: '5' } as never);
    await controller.runTestSuite({ suiteId: '5' } as never, { environment: 'TEST' } as never, user);
    await controller.listTestRuns({ status: 'PASSED' } as never, user);
    await controller.getTestRun({ runId: '9' } as never, user);
    expect(service.listTestSuites).toHaveBeenCalledWith({ module: 'auth' });
    expect(service.getTestSuite).toHaveBeenCalledWith('5');
    expect(service.runTestSuite).toHaveBeenCalledWith('5', { environment: 'TEST' }, user);
    expect(service.listTestRuns).toHaveBeenCalledWith({ status: 'PASSED' }, user);
    expect(service.getTestRun).toHaveBeenCalledWith('9', user);
  });

  it('el CRUD de suites/steps va a SystemsTestSuiteAdminService', async () => {
    const { controller, suiteAdminService } = build();
    const suiteBody = { code: 'S1' } as never;
    await controller.createTestSuite(suiteBody, user);
    await controller.updateTestSuite({ suiteId: '5' } as never, { name: 'x' } as never);
    await controller.createTestStep({ suiteId: '5' } as never, { name: 'step' } as never);
    await controller.updateTestStep({ suiteId: '5', stepId: '7' } as never, { name: 'y' } as never);
    await controller.reorderTestSteps({ suiteId: '5' } as never, { order: [] } as never);
    expect(suiteAdminService.createSuite).toHaveBeenCalledWith(suiteBody, user);
    expect(suiteAdminService.updateSuite).toHaveBeenCalledWith('5', { name: 'x' });
    expect(suiteAdminService.createStep).toHaveBeenCalledWith('5', { name: 'step' });
    expect(suiteAdminService.updateStep).toHaveBeenCalledWith('5', '7', { name: 'y' });
    expect(suiteAdminService.reorderSteps).toHaveBeenCalledWith('5', { order: [] });
  });
});
