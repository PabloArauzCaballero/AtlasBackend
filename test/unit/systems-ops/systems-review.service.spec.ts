import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { SystemsReviewService } from '../../../src/modules/systems-ops/systems-review.service.js';

/**
 * `SystemsReviewService` arma la cola de revisión del catálogo (6 categorías con su total) y aplica
 * decisiones de revisión, cada una con su NotFound propio. Spec directo con el repo mockeado; los
 * mappers y `actorId` corren de verdad.
 */
describe('SystemsReviewService', () => {
  function build() {
    const reviewRepository = {
      listReviewQueue: jest.fn(async (..._args: unknown[]) => ({
        endpoints: { rows: [] as unknown[], count: 0 },
        dataEntities: { rows: [] as unknown[], count: 0 },
        dataImpacts: { rows: [] as unknown[], count: 0 },
        fieldImpacts: { rows: [] as unknown[], count: 0 },
        dataColumns: { rows: [] as unknown[], count: 0 },
        toolRequirements: { rows: [] as unknown[], count: 0 },
      })),
      updateEndpointReview: jest.fn(async (..._args: unknown[]) => null),
      updateDataEntityReview: jest.fn(async (..._args: unknown[]) => null),
      updateDataImpactReview: jest.fn(async (..._args: unknown[]) => null),
      updateFieldImpactReview: jest.fn(async (..._args: unknown[]) => null),
      updateDataColumnReview: jest.fn(async (..._args: unknown[]) => null),
      updateToolRequirementReview: jest.fn(async (..._args: unknown[]) => null),
    };
    const service = new SystemsReviewService(reviewRepository as never);
    return { service, reviewRepository };
  }

  const user = { role: 'system_admin', tenantId: 't1', internalUserId: 'u1', platformUserId: null } as never;
  const decision = { reviewStatus: 'approved', reviewNotes: 'ok' } as never;

  it('getReviewQueue mapea las 6 categorías con su total', async () => {
    const { service, reviewRepository } = build();
    (reviewRepository.listReviewQueue as jest.Mock).mockResolvedValueOnce({
      endpoints: { rows: [{ id: 1, code: 'EP' }], count: 1 },
      dataEntities: { rows: [{ id: 2 }], count: 5 },
      dataImpacts: { rows: [{ id: 3, endpointId: 1, dataEntityId: 2 }], count: 3 },
      fieldImpacts: { rows: [{ id: 4, endpointId: 1, dataEntityId: 2 }], count: 2 },
      dataColumns: { rows: [{ id: 5 }], count: 4 },
      toolRequirements: { rows: [{ id: 6, endpointId: 1, toolId: 9 }], count: 7 },
    } as never);
    const res = await service.getReviewQueue({} as never);
    expect(res.endpoints).toMatchObject({ total: 1 });
    expect(res.endpoints.items[0]).toMatchObject({ endpointId: '1', code: 'EP' });
    expect(res.dataEntities.total).toBe(5);
    expect(res.toolRequirements.total).toBe(7);
  });

  it('reviewEndpoint lanza NotFound cuando el repo no devuelve fila', async () => {
    const { service } = build();
    await expect(service.reviewEndpoint('1', decision, user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reviewEndpoint mapea la fila actualizada y propaga decisión/rol/tenant', async () => {
    const { service, reviewRepository } = build();
    (reviewRepository.updateEndpointReview as jest.Mock).mockResolvedValueOnce({ id: 1, code: 'EP' } as never);
    const res = await service.reviewEndpoint('1', decision, user);
    expect(res).toMatchObject({ endpointId: '1' });
    expect(reviewRepository.updateEndpointReview).toHaveBeenCalledWith('1', decision, expect.anything(), 'system_admin', 't1');
  });

  it('reviewToolRequirement mapea la fila o lanza NotFound', async () => {
    const { service, reviewRepository } = build();
    await expect(service.reviewToolRequirement('6', decision, user)).rejects.toBeInstanceOf(NotFoundException);
    (reviewRepository.updateToolRequirementReview as jest.Mock).mockResolvedValueOnce({ id: 6, endpointId: 1, toolId: 9 } as never);
    expect(await service.reviewToolRequirement('6', decision, user)).toMatchObject({ requirementId: '6' });
  });

  describe('resto de reviews (data-entity / data-impact / field-impact / data-column)', () => {
    const cases = [
      { method: 'reviewDataEntity', repoMethod: 'updateDataEntityReview', row: { id: 2 }, key: 'entityId', expected: '2' },
      {
        method: 'reviewDataImpact',
        repoMethod: 'updateDataImpactReview',
        row: { id: 3, endpointId: 1, dataEntityId: 2 },
        key: 'impactId',
        expected: '3',
      },
      {
        method: 'reviewFieldImpact',
        repoMethod: 'updateFieldImpactReview',
        row: { id: 4, endpointId: 1, dataEntityId: 2 },
        key: 'fieldImpactId',
        expected: '4',
      },
      { method: 'reviewDataColumn', repoMethod: 'updateDataColumnReview', row: { id: 5 }, key: 'columnId', expected: '5' },
    ] as const;

    for (const c of cases) {
      it(`${c.method}: NotFound si el repo devuelve null; si no, mapea (${c.key})`, async () => {
        const nullCase = build();
        const svcNull = nullCase.service as unknown as Record<string, (id: string, d: unknown, u: unknown) => Promise<unknown>>;
        await expect(svcNull[c.method]('x', decision, user)).rejects.toBeInstanceOf(NotFoundException);

        const okCase = build();
        (okCase.reviewRepository as unknown as Record<string, jest.Mock>)[c.repoMethod].mockResolvedValueOnce(c.row as never);
        const svcOk = okCase.service as unknown as Record<string, (id: string, d: unknown, u: unknown) => Promise<Record<string, unknown>>>;
        const res = await svcOk[c.method]('x', decision, user);
        expect(res[c.key]).toBe(c.expected);
      });
    }
  });
});
