import { describe, expect, it, jest } from '@jest/globals';
import { CatalogIngestionRepository } from '../../../src/modules/catalog-management/catalog-ingestion.repository.js';

/** Verifica la persistencia de la ingesta: trabajos, filas en staging y su decisión. */
describe('CatalogIngestionRepository', () => {
  function buildRepo() {
    const models = {
      contextStagingItemModel: {
        findOne: jest.fn(async (..._args: unknown[]) => null),
        create: jest.fn(async (..._args: unknown[]) => ({})),
      },
      contextIngestionJobModel: { create: jest.fn(async (..._args: unknown[]) => ({})) },
    };
    const repo = new CatalogIngestionRepository(models.contextStagingItemModel as never, models.contextIngestionJobModel as never);
    return { repo, models };
  }

  const now = new Date('2026-01-01T00:00:00.000Z');

  it('updateStagingItemDecision fija estado, notas y updatedAt y guarda', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async (..._args: unknown[]) => ({ saved: true }));
    const item = { save } as never;
    await repo.updateStagingItemDecision(item, { reviewStatus: 'approved', reviewNotes: 'ok', now }, {});
    const it2 = item as { reviewStatus: string; reviewNotes: string; updatedAtValue: Date };
    expect(it2.reviewStatus).toBe('approved');
    expect(it2.reviewNotes).toBe('ok');
    expect(it2.updatedAtValue).toBe(now);
    expect(save).toHaveBeenCalledWith({ transaction: undefined });
  });

  it('createIngestionJob y createStagingItem delegan en model.create con {transaction} y campos mapeados', async () => {
    const { repo, models } = buildRepo();
    const opt = { transaction: 'tx' as never };
    await repo.createIngestionJob(
      {
        jobCode: 'J',
        sourceType: 'csv',
        sourceName: 'f',
        triggeredByType: 'platform_admin',
        triggeredByPlatformUserId: 'u',
        status: 'completed',
        summary: { n: 1 },
        now,
      } as never,
      opt,
    );
    expect((models.contextIngestionJobModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ jobCode: 'J', summaryJson: { n: 1 } });

    await repo.createStagingItem(
      {
        catalogId: 'c',
        ingestionJobId: 'j',
        proposedItemCode: null,
        proposedItemName: 'N',
        proposedAttributes: {},
        aiSuggested: true,
        createdByType: 'platform_admin',
        createdByPlatformUserId: 'u',
        now,
      } as never,
      opt,
    );
    expect((models.contextStagingItemModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      reviewStatus: 'pending_review',
      aiSuggested: true,
    });
  });

  it('findStagingItemById filtra por id', async () => {
    const { repo, models } = buildRepo();
    await repo.findStagingItemById('s1');
    expect((models.contextStagingItemModel.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { id: 's1' } });
  });
});
