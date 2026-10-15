import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
import { ExternalCustomerEvidenceRepository } from '../../../src/modules/external-data/infrastructure/external-customer-evidence.repository.js';

/**
 * Cobertura directa de `ExternalCustomerEvidenceRepository`: observaciones y snapshots de features. Modelos Sequelize mockeados.
 */
describe('ExternalCustomerEvidenceRepository', () => {
  function buildRepo() {
    const make = () => ({
      findOne: asyncMock(),
      findAll: asyncMock(),
      findByPk: asyncMock(),
      create: asyncMock(),
      update: asyncMock(),
      count: asyncMock(),
      bulkCreate: asyncMock(),
    });
    const models = {
      customerObservation: make(),
      featureSnapshot: make(),
    };
    const repo = new ExternalCustomerEvidenceRepository(models.customerObservation as never, models.featureSnapshot as never);
    return { repo, models };
  }

  it('listCustomerObservations trae solo las de origen external_provider', async () => {
    const { repo, models } = buildRepo();
    (models.customerObservation.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.listCustomerObservations('t1', 'c1');
    expect((models.customerObservation.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', customerId: 'c1', sourceType: 'external_provider' },
    });
  });

  it('createObservations corta con lista vacía y mapea valueType + verificationStatus', async () => {
    const empty = buildRepo();
    await empty.repo.createObservations({
      tenantId: 't1',
      customerId: 'c1',
      providerId: 'p1',
      requestId: 'r1',
      observations: [],
      now: new Date(),
    });
    expect(empty.models.customerObservation.bulkCreate).not.toHaveBeenCalled();

    const { repo, models } = buildRepo();
    await repo.createObservations({
      tenantId: 't1',
      customerId: 'c1',
      providerId: 'p1',
      requestId: 'r1',
      observations: [
        { observationKey: 'a', valueType: 'NUMBER', valueNumber: 0.5, confidenceScore: 0.9, verified: true } as never,
        { observationKey: 'b', valueType: 'STRING', valueString: 'x', verified: false, manualReviewRequired: true } as never,
        { observationKey: 'c', valueType: 'BOOLEAN', valueBoolean: true, verified: false, manualReviewRequired: false } as never,
      ],
      now: new Date(),
    });
    const rows = (models.customerObservation.bulkCreate as jest.Mock).mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ valueNumber: '0.5000', confidenceScore: '90.00', verificationStatus: 'verified' });
    expect(rows[1]).toMatchObject({ valueText: 'x', verificationStatus: 'manual_review_required' });
    expect(rows[2]).toMatchObject({ valueBoolean: true, verificationStatus: 'unverified' });
  });

  it('createFeatureSnapshot crea con sus campos derivados y listCustomerFeatureSnapshots filtra por entidad disparadora', async () => {
    const { repo, models } = buildRepo();
    (models.featureSnapshot.create as jest.Mock).mockResolvedValue({ id: 'fs1' } as never);
    (models.featureSnapshot.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.createFeatureSnapshot({
      tenantId: 't1',
      customerId: 'c1',
      providerCode: 'SEGIP',
      requestId: 'r1',
      featuresJson: {},
      missingFeaturesJson: {},
      integrityHash: 'h',
      now: new Date(),
    });
    expect((models.featureSnapshot.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      snapshotReason: 'external_provider_segip',
      triggeringEntityId: 'r1',
    });
    await repo.listCustomerFeatureSnapshots('t1', 'c1');
    expect((models.featureSnapshot.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', customerId: 'c1', triggeringEntityType: 'data_provider_request' },
    });
  });
});
