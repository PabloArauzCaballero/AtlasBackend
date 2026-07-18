import { describe, expect, it, jest } from '@jest/globals';
import { SessionsOnboardingLinkRepository } from '../../../src/modules/sessions/repositories/sessions-onboarding-link.repository.js';

/**
 * Cobertura directa de `SessionsOnboardingLinkRepository` (Fase 1.2 del plan 10/10): lectura del
 * flujo de onboarding más reciente y registro de eventos de paso desde una sesión activa. Modelos
 * Sequelize mockeados.
 */
describe('SessionsOnboardingLinkRepository', () => {
  function buildRepo() {
    const onboardingFlowModel = { findOne: jest.fn() };
    const onboardingStepEventModel = { create: jest.fn() };
    const repo = new SessionsOnboardingLinkRepository(onboardingFlowModel as never, onboardingStepEventModel as never);
    return { repo, onboardingFlowModel, onboardingStepEventModel };
  }

  const opts = { transaction: 'tx' as never };

  it('findLatestOnboardingFlow filtra por tenant+cliente y ordena por startedAt desc', async () => {
    const { repo, onboardingFlowModel } = buildRepo();
    (onboardingFlowModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findLatestOnboardingFlow('t1', 'c1', opts);
    const arg = (onboardingFlowModel.findOne as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; order: unknown };
    expect(arg.where).toEqual({ tenantId: 't1', customerId: 'c1' });
    expect(arg.order).toEqual([
      ['startedAt', 'DESC'],
      ['id', 'DESC'],
    ]);
  });

  it('createOnboardingStepEvent nace con errorCount 0, endedAt null y createdAtValue=occurredAt', async () => {
    const { repo, onboardingStepEventModel } = buildRepo();
    (onboardingStepEventModel.create as jest.Mock).mockResolvedValue({ id: 'ev1' } as never);
    const occurredAt = new Date('2026-01-12');
    await repo.createOnboardingStepEvent(
      { tenantId: 't1', onboardingFlowId: 'f1', stepCode: 'kyc', eventType: 'started', payload: { a: 1 }, occurredAt },
      opts,
    );
    expect((onboardingStepEventModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      errorCount: 0,
      endedAt: null,
      startedAt: occurredAt,
      createdAtValue: occurredAt,
      payloadJson: { a: 1 },
    });
  });
});
