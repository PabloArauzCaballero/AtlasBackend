import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { PartnerVerificationService } from '../../../src/modules/partner-onboarding/application/partner-verification.service.js';
import { PartnerOnboardingRepository } from '../../../src/modules/partner-onboarding/partner-onboarding.repository.js';

/**
 * La cola de expedientes (2026-09-29): no tenía buscador y «el más antiguo» salía de la página
 * cargada, así que desde la página 2 enseñaba una fecha falsa.
 */
describe('cola de expedientes de comercio', () => {
  function repo() {
    const profileModel = {
      findAndCountAll: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })),
      count: jest.fn(async (..._args: unknown[]) => 9),
      min: jest.fn(async (..._args: unknown[]) => new Date('2026-08-01T10:00:00.000Z')),
    };
    const repository = new PartnerOnboardingRepository(profileModel as never, {} as never, {} as never, {} as never, {} as never);
    return { repository, profileModel };
  }

  it('q busca por parte en nombre legal, nombre comercial y NIT, con comodines escapados', async () => {
    const { repository, profileModel } = repo();
    await repository.findProfilesAwaitingDecision('1', { limit: 25, offset: 0, q: '100_%' });
    const { where } = profileModel.findAndCountAll.mock.calls[0]![0] as { where: Record<string | symbol, unknown> };
    const pattern = '%100\\_\\%%';
    expect(where).toMatchObject({ tenantId: '1', onboardingStatus: 'under_review', deleted: false });
    expect(where[Op.or]).toEqual([
      { legalName: { [Op.iLike]: pattern } },
      { tradeName: { [Op.iLike]: pattern } },
      { taxId: { [Op.iLike]: pattern } },
    ]);
  });

  it('sin q no hay OR: la cola completa', async () => {
    const { repository, profileModel } = repo();
    await repository.findProfilesAwaitingDecision('1', { limit: 25, offset: 0 });
    const { where } = profileModel.findAndCountAll.mock.calls[0]![0] as { where: Record<string | symbol, unknown> };
    expect(where[Op.or]).toBeUndefined();
  });

  it('el resumen (total y el más antiguo) es de TODA la cola, no de la página ni de la búsqueda', async () => {
    const repository = {
      findProfilesAwaitingDecision: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 2 })),
      summarizeAwaitingDecision: jest.fn(async (..._args: unknown[]) => ({
        total: 9,
        oldestSubmittedAt: new Date('2026-08-01T10:00:00.000Z'),
      })),
    };
    const service = new PartnerVerificationService(repository as never, {} as never, {} as never, {} as never, {} as never);
    const result = await service.listAwaitingDecision('1', { page: 2, limit: 25, q: 'Sur' });
    expect(repository.findProfilesAwaitingDecision).toHaveBeenCalledWith('1', { limit: 25, offset: 25, q: 'Sur' });
    expect(repository.summarizeAwaitingDecision).toHaveBeenCalledWith('1');
    expect(result.summary).toEqual({ total: 9, oldestSubmittedAt: '2026-08-01T10:00:00.000Z' });
    expect(result.meta).toMatchObject({ total: 2, page: 2 });
  });
});
