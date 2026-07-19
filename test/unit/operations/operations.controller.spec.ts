import { describe, expect, it, jest } from '@jest/globals';
import { OperationsController } from '../../../src/modules/operations/operations.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';

/**
 * `OperationsController` combina la cola de revisión manual (OperationsService) y la de fraude
 * (FraudService). Spec directo: verifica el parseo de tenant, la exigencia de x-idempotency-key en
 * las decisiones y, en particular, que decideFraudCase rutea a FraudService (no a OperationsService).
 */
describe('OperationsController', () => {
  function build() {
    const operationsService = {
      getWorkQueue: jest.fn(async () => ({ items: [] })),
      getManualReviewCasesCursorPage: jest.fn(async () => ({ items: [] })),
      getFraudCasesCursorPage: jest.fn(async () => ({ items: [] })),
      getInvestigationSummary: jest.fn(async () => ({ customer: {} })),
      decideManualReviewCase: jest.fn(async () => ({ resolved: true })),
    };
    const fraudService = { decideFraudCase: jest.fn(async () => ({ resolved: true })) };
    return { controller: new OperationsController(operationsService as never, fraudService as never), operationsService, fraudService };
  }
  const user = { role: 'internal_operator', tenantId: '1', internalUserId: 'u1' } as never;

  it('getWorkQueue delega con el tenant parseado y la query', async () => {
    const { controller, operationsService } = build();
    await controller.getWorkQueue('1', { queue: 'all' } as never);
    expect(operationsService.getWorkQueue).toHaveBeenCalledWith(tenantIdFromHeader('1'), { queue: 'all' });
  });

  it('las variantes por cursor y el resumen de investigación delegan con el tenant', async () => {
    const { controller, operationsService } = build();
    await controller.getManualReviewCasesCursorPage('1', { cursor: 'c' } as never);
    await controller.getFraudCasesCursorPage('1', { cursor: 'c' } as never);
    await controller.getInvestigationSummary('1', { customerId: '9' } as never);
    expect(operationsService.getManualReviewCasesCursorPage).toHaveBeenCalledWith(tenantIdFromHeader('1'), { cursor: 'c' });
    expect(operationsService.getFraudCasesCursorPage).toHaveBeenCalledWith(tenantIdFromHeader('1'), { cursor: 'c' });
    expect(operationsService.getInvestigationSummary).toHaveBeenCalledWith(tenantIdFromHeader('1'), { customerId: '9' });
  });

  it('decideManualReviewCase delega en OperationsService y exige idempotency-key', async () => {
    const { controller, operationsService } = build();
    const params = { caseId: '3' } as never;
    const body = { decision: 'approved' } as never;
    await controller.decideManualReviewCase('1', 'idem', params, body, user);
    expect(operationsService.decideManualReviewCase).toHaveBeenCalledWith({ tenantId: tenantIdFromHeader('1'), params, body, currentUser: user, idempotencyKey: 'idem' });
    expect(() => controller.decideManualReviewCase('1', undefined, params, body, user)).toThrow();
  });

  it('decideFraudCase rutea a FraudService (no a OperationsService) y exige idempotency-key', async () => {
    const { controller, fraudService, operationsService } = build();
    const params = { caseId: '4' } as never;
    const body = { decision: 'confirmed_fraud' } as never;
    await controller.decideFraudCase('1', 'idem', params, body, user);
    expect(fraudService.decideFraudCase).toHaveBeenCalledWith({ tenantId: tenantIdFromHeader('1'), params, body, currentUser: user, idempotencyKey: 'idem' });
    expect(operationsService.decideManualReviewCase).not.toHaveBeenCalled();
    expect(() => controller.decideFraudCase('1', undefined, params, body, user)).toThrow();
  });
});
