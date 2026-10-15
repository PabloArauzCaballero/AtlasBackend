import { describe, expect, it, jest } from '@jest/globals';
import { RiskAssessmentRepository } from '../../../src/modules/risk/repositories/risk-assessment.repository.js';

/** Cobertura directa del agregado de evaluación: lecturas por corrida, la corrección por revisión manual y las escrituras. */
describe('RiskAssessmentRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() });
    const models = {
      riskAssessmentResult: make(),
      riskAssessmentRun: make(),
      riskAssessmentContext: make(),
      riskRuleFired: make(),
      riskFeatureContribution: make(),
    };
    const repo = new RiskAssessmentRepository(
      models.riskAssessmentResult as never,
      models.riskAssessmentRun as never,
      models.riskAssessmentContext as never,
      models.riskRuleFired as never,
      models.riskFeatureContribution as never,
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

  describe('lecturas por corrida de evaluación (expediente de la decisión)', () => {
    it('findRiskRun filtra por tenant e id de corrida', async () => {
      const { repo, models } = buildRepo();
      (models.riskAssessmentRun.findOne as jest.Mock).mockResolvedValue({ id: 'run1' } as never);
      await expect(repo.findRiskRun('t1', 'run1')).resolves.toEqual({ id: 'run1' });
      expect((models.riskAssessmentRun.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
        where: { tenantId: 't1', id: 'run1' },
      });
    });

    it('findRiskResultByRun / findRulesByRun / findContributionsByRun cuelgan de riskAssessmentRunId', async () => {
      const { repo, models } = buildRepo();
      (models.riskAssessmentResult.findOne as jest.Mock).mockResolvedValue(null as never);
      (models.riskRuleFired.findAll as jest.Mock).mockResolvedValue([] as never);
      (models.riskFeatureContribution.findAll as jest.Mock).mockResolvedValue([] as never);

      await repo.findRiskResultByRun('t1', 'run1');
      await repo.findRulesByRun('t1', 'run1');
      await repo.findContributionsByRun('t1', 'run1');

      const expected = { where: { tenantId: 't1', riskAssessmentRunId: 'run1' } };
      expect((models.riskAssessmentResult.findOne as jest.Mock).mock.calls[0][0]).toMatchObject(expected);
      expect((models.riskRuleFired.findAll as jest.Mock).mock.calls[0][0]).toMatchObject(expected);
      expect((models.riskFeatureContribution.findAll as jest.Mock).mock.calls[0][0]).toMatchObject(expected);
    });
  });

  describe('la vuelta de la revisión manual hecha en el Motor', () => {
    it('applyManualReviewOutcome corrige la acción recomendada y deja el rastro de la revisión en los motivos', async () => {
      const { repo } = buildRepo();
      const save = jest.fn(async (..._args: unknown[]) => undefined);
      const now = new Date('2026-09-14T20:00:00.000Z');
      const result = {
        recommendedAction: 'manual_review_required',
        reasonCodesJson: { reasons: ['decision_engine_unavailable'] },
        save,
      } as never;

      await repo.applyManualReviewOutcome(
        result,
        { recommendedAction: 'approved_for_next_step', reason: 'Todo en orden', now },
        { transaction: 'tx' as never },
      );

      expect(result).toMatchObject({
        recommendedAction: 'approved_for_next_step',
        reasonCodesJson: {
          reasons: ['decision_engine_unavailable'],
          manualReview: { resolution: 'approved_for_next_step', reason: 'Todo en orden', resolvedAt: now.toISOString() },
        },
      });
      expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
    });

    it('applyManualReviewOutcome no rompe si el resultado no tenía motivos', async () => {
      const { repo } = buildRepo();
      const result = { recommendedAction: 'x', reasonCodesJson: null, save: jest.fn(async (..._args: unknown[]) => undefined) } as never;
      await repo.applyManualReviewOutcome(
        result,
        { recommendedAction: 'rejected', reason: 'no', now: new Date() },
        { transaction: 'tx' as never },
      );
      expect((result as { reasonCodesJson: { manualReview: { resolution: string } } }).reasonCodesJson.manualReview.resolution).toBe(
        'rejected',
      );
    });
  });

  describe('escrituras del expediente de riesgo (create*)', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const opts = { transaction: 'tx' as never };
    const firstArg = (m: { create: jest.Mock }) => (m.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>;

    it('createRiskAssessmentRun / Context / RuleFired / Contribution mapean sus constantes', async () => {
      const { repo, models } = buildRepo();
      await repo.createRiskAssessmentRun(
        {
          tenantId: 't1',
          customerId: 'c1',
          sessionId: null,
          deviceId: null,
          featureSnapshotId: 's1',
          assessmentType: 'onboarding',
          triggerSource: 'api',
          idempotencyKey: 'k',
          now,
        } as never,
        opts,
      );
      expect(firstArg(models.riskAssessmentRun)).toMatchObject({ runStatus: 'completed', featureSnapshotId: 's1' });

      await repo.createRiskAssessmentContext({ tenantId: 't1', riskAssessmentRunId: 'run1', contextPayloadHash: 'h', now } as never, opts);
      expect(firstArg(models.riskAssessmentContext)).toMatchObject({
        contextType: 'onboarding',
        currencyCode: 'BOB',
        contextPayloadHash: 'h',
      });

      await repo.createRuleFired(
        {
          tenantId: 't1',
          riskAssessmentRunId: 'run1',
          ruleCode: 'R1',
          riskDimension: 'fraud',
          outputAction: 'review',
          reasonCode: 'RC',
          severity: 'high',
          isHardStop: true,
          inputValues: { x: 1 },
          rulesetVersionCode: 'rv1',
          now,
        } as never,
        opts,
      );
      expect(firstArg(models.riskRuleFired)).toMatchObject({
        ruleCodeSnapshot: 'R1',
        rulesetVersionCodeSnapshot: 'rv1',
        isHardStop: true,
        inputValuesJson: { x: 1 },
      });

      await repo.createContribution(
        {
          tenantId: 't1',
          riskAssessmentRunId: 'run1',
          featureCode: 'age',
          rawValue: { v: 30 },
          scorePoints: '5',
          reasonCode: 'RC',
          now,
        } as never,
        opts,
      );
      expect(firstArg(models.riskFeatureContribution)).toMatchObject({ featureCode: 'age', rawValueJson: { v: 30 }, scorePoints: '5' });
    });

    it('createRiskResult mapea sus constantes', async () => {
      const { repo, models } = buildRepo();
      await repo.createRiskResult(
        {
          tenantId: 't1',
          runId: 'run1',
          customerId: 'c1',
          sessionId: null,
          deviceId: null,
          assessmentType: 'onboarding',
          recommendedAction: 'approve',
          riskLevel: 'low',
          scoreTotal: '10',
          fraudScore: '1',
          identityScore: '2',
          deviceRiskScore: '3',
          behaviorScore: '4',
          contactabilityScore: '5',
          consistencyScore: '6',
          reasonCodes: { a: 1 },
          featureSnapshotId: 's1',
          integrityHash: 'h',
          modelVersionCode: 'mv1',
          rulesetVersionCode: 'rv1',
          now,
        } as never,
        opts,
      );
      expect(firstArg(models.riskAssessmentResult)).toMatchObject({
        subjectType: 'customer',
        riskAssessmentRunId: 'run1',
        reasonCodesJson: { a: 1 },
        recommendedAction: 'approve',
      });
    });
  });
});
