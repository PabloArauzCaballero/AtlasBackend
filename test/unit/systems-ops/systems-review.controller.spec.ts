import { describe, expect, it, jest } from '@jest/globals';
import { SystemsReviewController } from '../../../src/modules/systems-ops/systems-review.controller.js';

/**
 * `SystemsReviewController` expone la cola de revisión del catálogo y 6 decisiones de revisión, todas
 * delegando en `SystemsReviewService` con (paramId, body, user). Spec directo con el servicio mockeado.
 */
describe('SystemsReviewController', () => {
  function build() {
    const service = {
      getReviewQueue: jest.fn(async (..._args: unknown[]) => ({ endpoints: { items: [], total: 0 } })),
      reviewEndpoint: jest.fn(async (..._args: unknown[]) => ({ endpointId: '1' })),
      reviewToolRequirement: jest.fn(async (..._args: unknown[]) => ({ requirementId: '6' })),
      reviewDataEntity: jest.fn(async (..._args: unknown[]) => ({ entityId: '2' })),
      reviewDataImpact: jest.fn(async (..._args: unknown[]) => ({ impactId: '3' })),
      reviewFieldImpact: jest.fn(async (..._args: unknown[]) => ({ fieldImpactId: '4' })),
      reviewDataColumn: jest.fn(async (..._args: unknown[]) => ({ columnId: '5' })),
    };
    return { controller: new SystemsReviewController(service as never), service };
  }
  const user = { role: 'system_admin', tenantId: '1', internalUserId: 'u1' } as never;
  const body = { reviewStatus: 'approved', reviewNotes: 'ok' } as never;

  it('getReviewQueue delega la query', async () => {
    const { controller, service } = build();
    await controller.getReviewQueue({ type: 'endpoints' } as never);
    expect(service.getReviewQueue).toHaveBeenCalledWith({ type: 'endpoints' });
  });

  it('reviewEndpoint delega con (endpointId, body, user)', async () => {
    const { controller, service } = build();
    await controller.reviewEndpoint({ endpointId: '1' } as never, body, user);
    expect(service.reviewEndpoint).toHaveBeenCalledWith('1', body, user);
  });

  it('las 5 decisiones restantes delegan cada una en su método del servicio', async () => {
    const { controller, service } = build();
    await controller.reviewToolRequirement({ requirementId: '6' } as never, body, user);
    await controller.reviewDataEntity({ entityId: '2' } as never, body, user);
    await controller.reviewDataImpact({ impactId: '3' } as never, body, user);
    await controller.reviewFieldImpact({ fieldImpactId: '4' } as never, body, user);
    await controller.reviewDataColumn({ columnId: '5' } as never, body, user);
    expect(service.reviewToolRequirement).toHaveBeenCalledWith('6', body, user);
    expect(service.reviewDataEntity).toHaveBeenCalledWith('2', body, user);
    expect(service.reviewDataImpact).toHaveBeenCalledWith('3', body, user);
    expect(service.reviewFieldImpact).toHaveBeenCalledWith('4', body, user);
    expect(service.reviewDataColumn).toHaveBeenCalledWith('5', body, user);
  });
});
