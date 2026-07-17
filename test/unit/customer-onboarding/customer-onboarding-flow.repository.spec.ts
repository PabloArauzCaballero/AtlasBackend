import { describe, expect, it, jest } from '@jest/globals';
import { CustomerOnboardingFlowRepository } from '../../../src/modules/customer-onboarding/repositories/customer-onboarding-flow.repository.js';

/**
 * Cobertura directa de `CustomerOnboardingFlowRepository` (Fase 1.2 del plan 10/10): el ciclo de vida
 * del flujo de onboarding y sus eventos (paso, permiso, acción, auditoría). Sub-repo con lógica real
 * (defaults de alta del flujo/paso). Modelos Sequelize mockeados.
 */
describe('CustomerOnboardingFlowRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() });
    const models = {
      onboardingFlow: make(),
      onboardingStepEvent: make(),
      permissionEvent: make(),
      customerActionLog: make(),
      operationalAuditLog: make(),
      authEvent: make(),
    };
    const repo = new CustomerOnboardingFlowRepository(
      models.onboardingFlow as never,
      models.onboardingStepEvent as never,
      models.permissionEvent as never,
      models.customerActionLog as never,
      models.operationalAuditLog as never,
      models.authEvent as never,
    );
    return { repo, models };
  }

  const opts = { transaction: 'tx' as never };

  it('createOnboardingFlow nace sin completar (completedAt/abandonedAt null)', async () => {
    const { repo, models } = buildRepo();
    await repo.createOnboardingFlow(
      { tenantId: 't1', customerId: 'c1', sessionId: 's1', flowVersion: 'v1', startedAt: new Date('2026-01-01'), completionStatus: 'in_progress' },
      opts,
    );
    const [values] = (models.onboardingFlow.create as jest.Mock).mock.calls[0];
    expect(values).toMatchObject({ flowVersion: 'v1', completionStatus: 'in_progress', completedAt: null, abandonedAt: null });
  });

  it('findLatestOnboardingFlow ordena por startedAt DESC', async () => {
    const { repo, models } = buildRepo();
    (models.onboardingFlow.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findLatestOnboardingFlow('t1', 'c1');
    const options = (models.onboardingFlow.findOne as jest.Mock).mock.calls[0][0] as { where: unknown; order: unknown };
    expect(options.where).toMatchObject({ tenantId: 't1', customerId: 'c1' });
    expect(options.order).toEqual([
      ['startedAt', 'DESC'],
      ['id', 'DESC'],
    ]);
  });

  it('createOnboardingStepEvent nace con errorCount 0 y mapea happenedAt -> startedAt', async () => {
    const { repo, models } = buildRepo();
    await repo.createOnboardingStepEvent(
      { tenantId: 't1', onboardingFlowId: 'f1', stepCode: 'kyc', eventType: 'started', happenedAt: new Date('2026-01-01'), payloadJson: null },
      opts,
    );
    const [values] = (models.onboardingStepEvent.create as jest.Mock).mock.calls[0];
    expect(values).toMatchObject({ stepCode: 'kyc', eventType: 'started', errorCount: 0, startedAt: new Date('2026-01-01') });
  });
});
