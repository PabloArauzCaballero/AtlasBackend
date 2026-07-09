import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { CatalogIngestionService } from '../../../src/modules/catalog-management/application/catalog-ingestion.service.js';

/**
 * ATLAS-P12 (continuación de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, Fase 1 de
 * `catalog-management`): `decideStagingItems` es la puerta de entrada de items sugeridos
 * (a menudo por IA, `aiSuggested`) hacia el catálogo real que usa el motor de riesgo. El caso
 * más importante es `TARGET_VERSION_NOT_EDITABLE` — evita que alguien apruebe items nuevos hacia
 * una versión ya publicada o retirada, corrompiendo un catálogo que se supone congelado.
 */
describe('CatalogIngestionService', () => {
  function buildService() {
    const repository = {
      findCatalogByCode: jest.fn(),
      findSourceByCode: jest.fn(),
      createSource: jest.fn(),
      createIngestionJob: jest.fn(),
      createStagingItem: jest.fn(),
      createAudit: jest.fn(),
      createDataChange: jest.fn(),
      findCatalogVersionById: jest.fn(),
      findStagingItemById: jest.fn(),
      createContextItem: jest.fn(),
      createAlias: jest.fn(),
      createRiskMapping: jest.fn(),
      updateStagingItemDecision: jest.fn(),
      createApprovalEvent: jest.fn(),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const service = new CatalogIngestionService(repository as never, sequelize as never);
    return { service, repository };
  }

  const internalUser = { role: 'internal_operator', internalUserId: 'iu1', platformUserId: 'pu1' } as never;
  const context = { tenantId: 't1', ipAddress: null, userAgent: null, idempotencyKey: 'idem-1' };

  describe('ingestCatalog', () => {
    it('throws NotFoundException when the target catalog does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        service.ingestCatalog({
          body: { catalogCode: 'missing', sourceName: 's', sourceType: 'manual', items: [] } as never,
          currentUser: internalUser,
          context,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('reuses an existing source by code instead of creating a duplicate one', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 'cat-1' } as never);
      (repository.findSourceByCode as jest.Mock).mockResolvedValueOnce({ id: 'src-existing' } as never);
      (repository.createIngestionJob as jest.Mock).mockResolvedValueOnce({ id: 'job-1', status: 'completed' } as never);

      await service.ingestCatalog({
        body: { catalogCode: 'c1', sourceCode: 'existing-source', sourceName: 's', sourceType: 'manual', items: [] } as never,
        currentUser: internalUser,
        context,
      });

      expect(repository.createSource).not.toHaveBeenCalled();
    });

    it('creates a new source when none exists for the given code', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 'cat-1' } as never);
      (repository.findSourceByCode as jest.Mock).mockResolvedValueOnce(null as never);
      (repository.createSource as jest.Mock).mockResolvedValueOnce({ id: 'src-new' } as never);
      (repository.createIngestionJob as jest.Mock).mockResolvedValueOnce({ id: 'job-1', status: 'completed' } as never);

      await service.ingestCatalog({
        body: { catalogCode: 'c1', sourceCode: 'brand-new-source', sourceName: 's', sourceType: 'manual', items: [] } as never,
        currentUser: internalUser,
        context,
      });

      expect(repository.createSource).toHaveBeenCalledTimes(1);
    });

    it('creates one staging item per item in the batch, and reports the exact count', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 'cat-1' } as never);
      (repository.findSourceByCode as jest.Mock).mockResolvedValueOnce({ id: 'src-1' } as never);
      (repository.createIngestionJob as jest.Mock).mockResolvedValueOnce({ id: 'job-1', status: 'completed' } as never);

      const result = await service.ingestCatalog({
        body: {
          catalogCode: 'c1',
          sourceCode: 's1',
          sourceName: 's',
          sourceType: 'manual',
          items: [
            { rawValue: 'A', itemType: 'merchant', aiSuggested: true },
            { rawValue: 'B', itemType: 'merchant', aiSuggested: false },
          ],
        } as never,
        currentUser: internalUser,
        context,
      });

      expect(repository.createStagingItem).toHaveBeenCalledTimes(2);
      expect(result.stagingItemsCreated).toBe(2);
    });
  });

  describe('decideStagingItems', () => {
    function baseInput(decisions: Record<string, unknown>[]) {
      return { body: { targetCatalogVersionId: 'v1', decisions } as never, currentUser: internalUser, context };
    }

    it('throws NotFoundException when the target version does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogVersionById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.decideStagingItems(baseInput([]))).rejects.toThrow(NotFoundException);
    });

    it.each(['published', 'retired', 'approved'])('throws TARGET_VERSION_NOT_EDITABLE when the version status is "%s"', async (status) => {
      const { service, repository } = buildService();
      (repository.findCatalogVersionById as jest.Mock).mockResolvedValueOnce({ id: 'v1', status } as never);
      await expect(service.decideStagingItems(baseInput([]))).rejects.toThrow(/TARGET_VERSION_NOT_EDITABLE/);
    });

    it.each(['draft', 'pending_approval'])('allows deciding staging items when the version status is "%s"', async (status) => {
      const { service, repository } = buildService();
      (repository.findCatalogVersionById as jest.Mock).mockResolvedValueOnce({ id: 'v1', status } as never);
      const result = await service.decideStagingItems(baseInput([]));
      expect(result.processed).toBe(0);
    });

    it('throws NotFoundException when a decision references a staging item that does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogVersionById as jest.Mock).mockResolvedValueOnce({ id: 'v1', status: 'draft' } as never);
      (repository.findStagingItemById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        service.decideStagingItems(baseInput([{ stagingItemId: 'missing', decision: 'approve', aliases: [], riskMappings: [] }])),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a decision when the staging item belongs to a different catalog than the target version (cross-catalog contamination)', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogVersionById as jest.Mock).mockResolvedValueOnce({ id: 'v1', status: 'draft', catalogId: 'cat-A' } as never);
      (repository.findStagingItemById as jest.Mock).mockResolvedValueOnce({
        id: 'staging-1',
        catalogId: 'cat-B',
        proposedItemCode: 'sc1',
        proposedItemName: 'Staged Name',
        proposedAttributesJson: { itemType: 'merchant' },
      } as never);

      await expect(
        service.decideStagingItems(
          baseInput([{ stagingItemId: 'staging-1', decision: 'approve', aliases: [], riskMappings: [] }]),
        ),
      ).rejects.toThrow(/catálogo distinto/);
      expect(repository.createContextItem).not.toHaveBeenCalled();
    });

    it('an "approve" decision creates a context item, its aliases and risk mappings, and marks the staging item approved', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogVersionById as jest.Mock).mockResolvedValueOnce({ id: 'v1', status: 'draft' } as never);
      (repository.findStagingItemById as jest.Mock).mockResolvedValueOnce({
        id: 'staging-1',
        proposedItemCode: 'sc1',
        proposedItemName: 'Staged Name',
        proposedAttributesJson: { itemType: 'merchant' },
      } as never);
      (repository.createContextItem as jest.Mock).mockResolvedValueOnce({ id: 'item-1' } as never);

      const result = await service.decideStagingItems(
        baseInput([
          {
            stagingItemId: 'staging-1',
            decision: 'approve',
            aliases: [{ aliasValue: 'a1', aliasType: 'name' }],
            riskMappings: [{ riskDimension: 'd', riskBand: 'low', reasonCode: 'r' }],
          },
        ]),
      );

      expect(repository.createContextItem).toHaveBeenCalledTimes(1);
      expect(repository.createAlias).toHaveBeenCalledTimes(1);
      expect(repository.createRiskMapping).toHaveBeenCalledTimes(1);
      const decisionArgs = (repository.updateStagingItemDecision as jest.Mock).mock.calls[0][1] as { reviewStatus: string };
      expect(decisionArgs.reviewStatus).toBe('approved');
      expect(result).toMatchObject({ approved: 1, rejected: 0, itemsCreated: 1 });
    });

    it('a "reject" decision does NOT create a context item, and marks the staging item rejected', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogVersionById as jest.Mock).mockResolvedValueOnce({ id: 'v1', status: 'draft' } as never);
      (repository.findStagingItemById as jest.Mock).mockResolvedValueOnce({
        id: 'staging-1',
        proposedItemCode: 'sc1',
        proposedItemName: 'x',
      } as never);

      const result = await service.decideStagingItems(
        baseInput([{ stagingItemId: 'staging-1', decision: 'reject', decisionReason: 'not relevant' }]),
      );

      expect(repository.createContextItem).not.toHaveBeenCalled();
      const decisionArgs = (repository.updateStagingItemDecision as jest.Mock).mock.calls[0][1] as { reviewStatus: string };
      expect(decisionArgs.reviewStatus).toBe('rejected');
      expect(result).toMatchObject({ approved: 0, rejected: 1, itemsCreated: 0 });
    });

    it('throws APPROVED_STAGING_ITEM_REQUIRES_ITEM_CODE_AND_NAME when approving a staging item with neither a provided nor a proposed item code', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogVersionById as jest.Mock).mockResolvedValueOnce({ id: 'v1', status: 'draft' } as never);
      (repository.findStagingItemById as jest.Mock).mockResolvedValueOnce({
        id: 'staging-1',
        proposedItemCode: null,
        proposedItemName: null,
      } as never);

      await expect(
        service.decideStagingItems(baseInput([{ stagingItemId: 'staging-1', decision: 'approve', aliases: [], riskMappings: [] }])),
      ).rejects.toThrow(/APPROVED_STAGING_ITEM_REQUIRES_ITEM_CODE_AND_NAME/);
    });

    it('an explicit itemCode/itemName in the decision overrides the staged proposal', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogVersionById as jest.Mock).mockResolvedValueOnce({ id: 'v1', status: 'draft' } as never);
      (repository.findStagingItemById as jest.Mock).mockResolvedValueOnce({
        id: 'staging-1',
        proposedItemCode: 'proposed-code',
        proposedItemName: 'Proposed Name',
        proposedAttributesJson: {},
      } as never);
      (repository.createContextItem as jest.Mock).mockResolvedValueOnce({ id: 'item-1' } as never);

      await service.decideStagingItems(
        baseInput([
          {
            stagingItemId: 'staging-1',
            decision: 'approve',
            itemCode: 'override-code',
            itemName: 'Override Name',
            aliases: [],
            riskMappings: [],
          },
        ]),
      );

      const createArgs = (repository.createContextItem as jest.Mock).mock.calls[0][0] as { itemCode: string; itemName: string };
      expect(createArgs).toMatchObject({ itemCode: 'override-code', itemName: 'Override Name' });
    });

    it('processes a mixed batch of approvals and rejections, tallying each correctly', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogVersionById as jest.Mock).mockResolvedValueOnce({ id: 'v1', status: 'pending_approval' } as never);
      (repository.findStagingItemById as jest.Mock)
        .mockResolvedValueOnce({ id: 's1', proposedItemCode: 'c1', proposedItemName: 'n1', proposedAttributesJson: {} } as never)
        .mockResolvedValueOnce({ id: 's2', proposedItemCode: 'c2', proposedItemName: 'n2' } as never);
      (repository.createContextItem as jest.Mock).mockResolvedValueOnce({ id: 'item-1' } as never);

      const result = await service.decideStagingItems(
        baseInput([
          { stagingItemId: 's1', decision: 'approve', aliases: [], riskMappings: [] },
          { stagingItemId: 's2', decision: 'reject', decisionReason: 'duplicate' },
        ]),
      );

      expect(result).toMatchObject({ processed: 2, approved: 1, rejected: 1, itemsCreated: 1 });
    });
  });
});
