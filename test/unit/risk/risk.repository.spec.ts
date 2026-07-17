import { describe, expect, it, jest } from '@jest/globals';
import { RiskRepository } from '../../../src/modules/risk/risk.repository.js';

/**
 * Cobertura directa de `RiskRepository` (Fase 1.2 del plan 10/10). `risk` es un dominio crítico con
 * umbral propio, y su repositorio no tenía spec: los tests de servicio/controller lo mockean, así
 * que sus funciones quedaban sin ejercitar. Aquí se verifican los accesos de lectura del expediente
 * de riesgo (que alimentan una decisión de crédito) y el enlace del snapshot con su corrida.
 */
describe('RiskRepository', () => {
  /** El repo inyecta 18 modelos; se mockean todos y se devuelven los que se asertan. */
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() });
    const models = {
      riskAssessmentResult: make(),
      riskAssessmentRun: make(),
      riskAssessmentContext: make(),
      riskRuleFired: make(),
      riskFeatureContribution: make(),
      featureComputationRun: make(),
      featureValue: make(),
      featureLineageLink: make(),
      featureSnapshot: make(),
      manualReviewCase: make(),
      fraudCase: make(),
      watchlistMatch: make(),
      dataQualityIssue: make(),
      dataChangeLog: make(),
      operationalAuditLog: make(),
      consent: make(),
      contactMethod: make(),
      identityDocument: make(),
    };
    const repo = new RiskRepository(
      models.riskAssessmentResult as never,
      models.riskAssessmentRun as never,
      models.riskAssessmentContext as never,
      models.riskRuleFired as never,
      models.riskFeatureContribution as never,
      models.featureComputationRun as never,
      models.featureValue as never,
      models.featureLineageLink as never,
      models.featureSnapshot as never,
      models.manualReviewCase as never,
      models.fraudCase as never,
      models.watchlistMatch as never,
      models.dataQualityIssue as never,
      models.dataChangeLog as never,
      models.operationalAuditLog as never,
      models.consent as never,
      models.contactMethod as never,
      models.identityDocument as never,
    );
    return { repo, models };
  }

  it('findLatestCustomerRiskResult toma el resultado más reciente (decidedAt DESC, id DESC como desempate)', async () => {
    const { repo, models } = buildRepo();
    (models.riskAssessmentResult.findOne as jest.Mock).mockResolvedValue({ id: 'r1' } as never);

    const result = await repo.findLatestCustomerRiskResult('t1', 'c1');

    expect(result).toEqual({ id: 'r1' });
    const options = (models.riskAssessmentResult.findOne as jest.Mock).mock.calls[0][0] as {
      where: unknown;
      order: unknown;
    };
    expect(options.where).toEqual({ tenantId: 't1', customerId: 'c1' });
    expect(options.order).toEqual([
      ['decidedAt', 'DESC'],
      ['id', 'DESC'],
    ]);
  });

  it('findCustomerConsents devuelve SOLO los consentimientos otorgados (granted: true)', async () => {
    const { repo, models } = buildRepo();
    (models.consent.findAll as jest.Mock).mockResolvedValue([] as never);

    await repo.findCustomerConsents('t1', 'c1');

    // Regla de negocio: un consentimiento revocado no debe alimentar una decisión de riesgo.
    const options = (models.consent.findAll as jest.Mock).mock.calls[0][0] as { where: unknown };
    expect(options.where).toEqual({ tenantId: 't1', customerId: 'c1', granted: true });
  });

  it('findCustomerContacts y findIdentityDocuments filtran por tenant + cliente', async () => {
    const { repo, models } = buildRepo();
    (models.contactMethod.findAll as jest.Mock).mockResolvedValue([] as never);
    (models.identityDocument.findAll as jest.Mock).mockResolvedValue([] as never);

    await repo.findCustomerContacts('t1', 'c1');
    await repo.findIdentityDocuments('t1', 'c1');

    expect((models.contactMethod.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', customerId: 'c1' },
    });
    expect((models.identityDocument.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', customerId: 'c1' },
    });
  });

  describe('lecturas por corrida de evaluación (expediente de la decisión)', () => {
    it('findRiskRun filtra por tenant e id de corrida', async () => {
      const { repo, models } = buildRepo();
      (models.riskAssessmentRun.findOne as jest.Mock).mockResolvedValue({ id: 'run1' } as never);
      await expect(repo.findRiskRun('t1', 'run1')).resolves.toEqual({ id: 'run1' });
      expect((models.riskAssessmentRun.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
        where: { tenantId: 't1', id: 'run1' },
      });
    });

    it('findRiskResultByRun / findRulesByRun / findContributionsByRun / findSnapshotByRun cuelgan de riskAssessmentRunId', async () => {
      const { repo, models } = buildRepo();
      (models.riskAssessmentResult.findOne as jest.Mock).mockResolvedValue(null as never);
      (models.riskRuleFired.findAll as jest.Mock).mockResolvedValue([] as never);
      (models.riskFeatureContribution.findAll as jest.Mock).mockResolvedValue([] as never);
      (models.featureSnapshot.findOne as jest.Mock).mockResolvedValue(null as never);

      await repo.findRiskResultByRun('t1', 'run1');
      await repo.findRulesByRun('t1', 'run1');
      await repo.findContributionsByRun('t1', 'run1');
      await repo.findSnapshotByRun('t1', 'run1');

      const expected = { where: { tenantId: 't1', riskAssessmentRunId: 'run1' } };
      expect((models.riskAssessmentResult.findOne as jest.Mock).mock.calls[0][0]).toMatchObject(expected);
      expect((models.riskRuleFired.findAll as jest.Mock).mock.calls[0][0]).toMatchObject(expected);
      expect((models.riskFeatureContribution.findAll as jest.Mock).mock.calls[0][0]).toMatchObject(expected);
      expect((models.featureSnapshot.findOne as jest.Mock).mock.calls[0][0]).toMatchObject(expected);
    });
  });

  it('attachSnapshotToRun enlaza el snapshot con la corrida y guarda dentro de la transacción', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => undefined);
    const snapshot = { save } as never;

    await repo.attachSnapshotToRun(snapshot, 'run1', { transaction: 'tx' as never });

    expect((snapshot as { riskAssessmentRunId: string }).riskAssessmentRunId).toBe('run1');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });
});
