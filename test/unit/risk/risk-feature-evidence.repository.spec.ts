import { describe, expect, it, jest } from '@jest/globals';
import { RiskFeatureEvidenceRepository } from '../../../src/modules/risk/repositories/risk-feature-evidence.repository.js';

/** Cobertura directa de la evidencia de features: corrida, valores y snapshot. */
describe('RiskFeatureEvidenceRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), create: jest.fn() });
    const models = { featureComputationRun: make(), featureValue: make(), featureSnapshot: make() };
    const repo = new RiskFeatureEvidenceRepository(
      models.featureComputationRun as never,
      models.featureValue as never,
      models.featureSnapshot as never,
    );
    return { repo, models };
  }

  const now = new Date('2026-01-01T00:00:00.000Z');
  const opts = { transaction: 'tx' as never };
  const firstArg = (m: { create: jest.Mock }) => (m.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
  const secondArg = (m: { create: jest.Mock }) => (m.create as jest.Mock).mock.calls[0][1] as Record<string, unknown>;

  it('findSnapshotByRun cuelga de riskAssessmentRunId', async () => {
    const { repo, models } = buildRepo();
    (models.featureSnapshot.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findSnapshotByRun('t1', 'run1');
    expect((models.featureSnapshot.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', riskAssessmentRunId: 'run1' },
    });
  });

  it('attachSnapshotToRun enlaza el snapshot con la corrida y guarda dentro de la transacción', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async (..._args: unknown[]) => undefined);
    const snapshot = { save } as never;

    await repo.attachSnapshotToRun(snapshot, 'run1', { transaction: 'tx' as never });

    expect((snapshot as { riskAssessmentRunId: string }).riskAssessmentRunId).toBe('run1');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('createFeatureComputationRun / FeatureValue / FeatureSnapshot mapean sus constantes', async () => {
    const { repo, models } = buildRepo();
    await repo.createFeatureComputationRun(
      {
        tenantId: 't1',
        customerId: 'c1',
        sessionId: null,
        deviceId: null,
        runReason: 'onboarding',
        triggerSource: 'api',
        idempotencyKey: 'k',
        now,
      } as never,
      opts,
    );
    expect(firstArg(models.featureComputationRun)).toMatchObject({
      subjectType: 'customer',
      featureSetVersion: 'atlas-mvp-v1',
      status: 'completed',
    });
    expect(secondArg(models.featureComputationRun)).toEqual({ transaction: 'tx' });

    await repo.createFeatureValue(
      {
        tenantId: 't1',
        computationRunId: 'r1',
        customerId: 'c1',
        sessionId: null,
        deviceId: null,
        featureCode: 'age',
        valueNumber: '30',
        valueBoolean: null,
        valueText: null,
        valueJson: null,
        now,
      } as never,
      opts,
    );
    expect(firstArg(models.featureValue)).toMatchObject({ confidenceScore: '1.0000', derivationMethod: 'age', valueNumber: '30' });

    await repo.createFeatureSnapshot(
      {
        tenantId: 't1',
        customerId: 'c1',
        deviceId: null,
        sessionId: null,
        featuresJson: { a: 1 },
        missingFeaturesJson: {},
        integrityHash: 'h',
        now,
      } as never,
      opts,
    );
    expect(firstArg(models.featureSnapshot)).toMatchObject({
      snapshotReason: 'risk_assessment',
      featuresJson: { a: 1 },
      integrityHash: 'h',
    });
  });
});
