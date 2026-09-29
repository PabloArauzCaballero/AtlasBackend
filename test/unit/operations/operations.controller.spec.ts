import { describe, expect, it, jest } from '@jest/globals';
import { OperationsController } from '../../../src/modules/operations/operations.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';
import { ROLES_KEY } from '../../../src/common/decorators/roles.decorator.js';

/**
 * `OperationsController` combina la cola de revisión manual (OperationsService) y la de fraude
 * (FraudService). Spec directo: verifica el parseo de tenant, la exigencia de x-idempotency-key en
 * las decisiones y, en particular, que decideFraudCase rutea a FraudService (no a OperationsService).
 */
describe('OperationsController', () => {
  function build() {
    const operationsService = {
      getInvestigationSummary: jest.fn(async (..._args: unknown[]) => ({ customer: {} })),
      decideManualReviewCase: jest.fn(async (..._args: unknown[]) => ({ resolved: true })),
    };
    const workQueue = {
      getWorkQueue: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
      getManualReviewCasesCursorPage: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
      getFraudCasesCursorPage: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
    };
    const fraudService = { decideFraudCase: jest.fn(async (..._args: unknown[]) => ({ resolved: true })) };
    return {
      controller: new OperationsController(
        operationsService as never,
        workQueue as never,
        fraudService as never,
        { list: jest.fn() } as never,
        { calcular: jest.fn(), ultimo: jest.fn() } as never,
      ),
      operationsService,
      workQueue,
      fraudService,
    };
  }
  const user = { role: 'internal_operator', tenantId: '1', internalUserId: 'u1' } as never;

  it('getWorkQueue delega con el tenant parseado, la query y el ROL de quien pide (acota a fraude)', async () => {
    const { controller, workQueue } = build();
    await controller.getWorkQueue('1', { queue: 'all' } as never, user);
    expect(workQueue.getWorkQueue).toHaveBeenCalledWith(tenantIdFromHeader('1'), { queue: 'all' }, 'internal_operator');
  });

  it('work-queue admite a fraud_analyst en @Roles (el servicio lo acota a queue=fraud); la decisión manual no', () => {
    const roles = (name: keyof OperationsController) =>
      Reflect.getMetadata(ROLES_KEY, OperationsController.prototype[name] as object) as string[] | undefined;
    expect(roles('getWorkQueue')).toContain('fraud_analyst');
    expect(roles('decideManualReviewCase')).not.toContain('fraud_analyst');
  });

  it('las variantes por cursor y el resumen de investigación delegan con el tenant', async () => {
    const { controller, operationsService, workQueue } = build();
    await controller.getManualReviewCasesCursorPage('1', { cursor: 'c' } as never);
    await controller.getFraudCasesCursorPage('1', { cursor: 'c' } as never);
    await controller.getInvestigationSummary('1', { customerId: '9' } as never);
    expect(workQueue.getManualReviewCasesCursorPage).toHaveBeenCalledWith(tenantIdFromHeader('1'), { cursor: 'c' });
    expect(workQueue.getFraudCasesCursorPage).toHaveBeenCalledWith(tenantIdFromHeader('1'), { cursor: 'c' });
    expect(operationsService.getInvestigationSummary).toHaveBeenCalledWith(tenantIdFromHeader('1'), { customerId: '9' });
  });

  it('decideManualReviewCase delega en OperationsService y exige idempotency-key', async () => {
    const { controller, operationsService } = build();
    const params = { caseId: '3' } as never;
    const body = { decision: 'approved' } as never;
    await controller.decideManualReviewCase('1', 'idem', params, body, user);
    expect(operationsService.decideManualReviewCase).toHaveBeenCalledWith({
      tenantId: tenantIdFromHeader('1'),
      params,
      body,
      currentUser: user,
      idempotencyKey: 'idem',
    });
    expect(() => controller.decideManualReviewCase('1', undefined, params, body, user)).toThrow();
  });

  it('decideFraudCase rutea a FraudService (no a OperationsService) y exige idempotency-key', async () => {
    const { controller, fraudService, operationsService } = build();
    const params = { caseId: '4' } as never;
    const body = { decision: 'confirmed_fraud' } as never;
    await controller.decideFraudCase('1', 'idem', params, body, user);
    expect(fraudService.decideFraudCase).toHaveBeenCalledWith({
      tenantId: tenantIdFromHeader('1'),
      params,
      body,
      currentUser: user,
      idempotencyKey: 'idem',
    });
    expect(operationsService.decideManualReviewCase).not.toHaveBeenCalled();
    expect(() => controller.decideFraudCase('1', undefined, params, body, user)).toThrow();
  });
});
