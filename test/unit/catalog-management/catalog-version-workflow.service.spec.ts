import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CatalogVersionWorkflowService } from '../../../src/modules/catalog-management/application/catalog-version-workflow.service.js';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 1): primer test real de
 * `catalog-management`. Cubre la máquina de estados de
 * aprobación de versiones de catálogo (`draft -> pending_approval -> approved -> published ->
 * retired`), que alimenta directamente al motor de riesgo — un estado mal validado aquí no es un
 * bug cosmético, es un problema de integridad de una decisión de crédito río abajo.
 */
describe('CatalogVersionWorkflowService', () => {
  function buildTransactionMock() {
    return jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({}));
  }

  function buildService() {
    const repository = {
      findCatalogByCode: jest.fn(),
      createCatalogVersion: jest.fn(),
      findSourceByCode: jest.fn(),
      createContextItem: jest.fn(),
      createAlias: jest.fn(),
      createRiskMapping: jest.fn(),
      createApprovalEvent: jest.fn(),
      createAudit: jest.fn(),
      createDataChange: jest.fn(),
      findCatalogVersion: jest.fn(),
      findItemsByVersion: jest.fn(),
      updateCatalogVersionStatus: jest.fn(),
    };
    const sequelize = { transaction: buildTransactionMock() };
    const service = new CatalogVersionWorkflowService(repository as never, sequelize as never);
    return { service, repository, sequelize };
  }

  const internalUser = { role: 'internal_operator', internalUserId: 'iu-1', platformUserId: null } as never;
  const adminUser = { role: 'admin', internalUserId: 'iu-1', platformUserId: null } as never;
  const customerUser = { role: 'customer', internalUserId: null, platformUserId: null } as never;
  const context = { tenantId: 't1', ipAddress: null, userAgent: null, idempotencyKey: 'idem-1' };

  describe('guards shared by all 3 methods (assertInternal / requireIdempotency)', () => {
    it('createCatalogVersion rejects a non-internal actor before touching the repository', async () => {
      const { service, repository } = buildService();
      await expect(
        service.createCatalogVersion({ catalogCode: 'c1', body: { items: [] } as never, currentUser: customerUser, context }),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.findCatalogByCode).not.toHaveBeenCalled();
    });

    it('submitCatalogVersion requires an X-Idempotency-Key before touching the repository', async () => {
      const { service, repository } = buildService();
      await expect(
        service.submitCatalogVersion({
          catalogCode: 'c1',
          versionId: 'v1',
          body: { notes: 'x' } as never,
          currentUser: internalUser,
          context: { ...context, idempotencyKey: undefined },
        }),
      ).rejects.toThrow(/Idempotency/);
      expect(repository.findCatalogByCode).not.toHaveBeenCalled();
    });
  });

  describe('createCatalogVersion', () => {
    it('throws NotFoundException when the catalog does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        service.createCatalogVersion({ catalogCode: 'missing', body: { items: [] } as never, currentUser: internalUser, context }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates the new version in draft status, always, regardless of what the caller sends', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.createCatalogVersion as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'draft' } as never);

      await service.createCatalogVersion({
        catalogCode: 'c1',
        body: { versionCode: 'v1', items: [] } as never,
        currentUser: internalUser,
        context,
      });

      const callArgs = (repository.createCatalogVersion as jest.Mock).mock.calls[0][0] as { status: string };
      expect(callArgs.status).toBe('draft');
    });

    it('counts aliases and risk mappings created across all items, not just the first item', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.createCatalogVersion as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'draft' } as never);
      (repository.createContextItem as jest.Mock).mockResolvedValueOnce({ id: 100 } as never).mockResolvedValueOnce({ id: 101 } as never);

      const result = await service.createCatalogVersion({
        catalogCode: 'c1',
        body: {
          versionCode: 'v1',
          items: [
            {
              itemCode: 'i1',
              itemName: 'Item 1',
              itemType: 'merchant',
              attributes: {},
              aliases: [{ aliasValue: 'a' }, { aliasValue: 'b' }],
              riskMappings: [{ riskDimension: 'd', riskBand: 'low', reasonCode: 'r' }],
            },
            { itemCode: 'i2', itemName: 'Item 2', itemType: 'merchant', attributes: {}, aliases: [{ aliasValue: 'c' }], riskMappings: [] },
          ],
        } as never,
        currentUser: internalUser,
        context,
      });

      expect(result.aliasesCreated).toBe(3);
      expect(result.riskMappingsCreated).toBe(1);
      expect(result.itemsCreated).toBe(2);
    });
  });

  describe('submitCatalogVersion (draft -> pending_approval)', () => {
    it('throws NotFoundException when the catalog does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        service.submitCatalogVersion({ catalogCode: 'missing', versionId: 'v1', body: {} as never, currentUser: internalUser, context }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the version does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        service.submitCatalogVersion({ catalogCode: 'c1', versionId: 'missing', body: {} as never, currentUser: internalUser, context }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws CATALOG_VERSION_NOT_DRAFT if the version is not in draft status', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'approved' } as never);
      await expect(
        service.submitCatalogVersion({ catalogCode: 'c1', versionId: '10', body: {} as never, currentUser: internalUser, context }),
      ).rejects.toThrow(/CATALOG_VERSION_NOT_DRAFT/);
    });

    it('throws CATALOG_VERSION_WITHOUT_ITEMS if the draft version has no items', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'draft' } as never);
      (repository.findItemsByVersion as jest.Mock).mockResolvedValueOnce([] as never);
      await expect(
        service.submitCatalogVersion({ catalogCode: 'c1', versionId: '10', body: {} as never, currentUser: internalUser, context }),
      ).rejects.toThrow(/CATALOG_VERSION_WITHOUT_ITEMS/);
    });

    it('happy path: a draft version with items moves to pending_approval', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'draft' } as never);
      (repository.findItemsByVersion as jest.Mock).mockResolvedValueOnce([{ id: 100 }] as never);
      (repository.updateCatalogVersionStatus as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'pending_approval' } as never);

      const result = await service.submitCatalogVersion({
        catalogCode: 'c1',
        versionId: '10',
        body: { notes: 'listo' } as never,
        currentUser: internalUser,
        context,
      });

      expect(result.status).toBe('pending_approval');
      const statusArgs = (repository.updateCatalogVersionStatus as jest.Mock).mock.calls[0][1] as { status: string };
      expect(statusArgs.status).toBe('pending_approval');
    });
  });

  describe('decideCatalogVersion (pending_approval -> approved -> published, or -> retired/rejected)', () => {
    it('rejects a non-admin internal actor before touching the repository — only admin/platform_admin may decide', async () => {
      const { service, repository } = buildService();
      await expect(
        service.decideCatalogVersion({
          catalogCode: 'c1',
          versionId: '10',
          body: { decision: 'approve' } as never,
          currentUser: internalUser,
          context,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.findCatalogByCode).not.toHaveBeenCalled();
    });

    it('throws CATALOG_VERSION_NOT_PENDING_APPROVAL when approving a version that is not pending_approval', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'draft' } as never);
      await expect(
        service.decideCatalogVersion({
          catalogCode: 'c1',
          versionId: '10',
          body: { decision: 'approve' } as never,
          currentUser: adminUser,
          context,
        }),
      ).rejects.toThrow(/CATALOG_VERSION_NOT_PENDING_APPROVAL/);
    });

    it('throws CATALOG_VERSION_NOT_READY_TO_PUBLISH when publishing a version that is neither approved nor pending_approval', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'draft' } as never);
      await expect(
        service.decideCatalogVersion({
          catalogCode: 'c1',
          versionId: '10',
          body: { decision: 'publish' } as never,
          currentUser: adminUser,
          context,
        }),
      ).rejects.toThrow(/CATALOG_VERSION_NOT_READY_TO_PUBLISH/);
    });

    it('allows publishing directly from pending_approval, skipping approved — documents real, non-obvious behavior', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'pending_approval' } as never);
      (repository.updateCatalogVersionStatus as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'published' } as never);

      const result = await service.decideCatalogVersion({
        catalogCode: 'c1',
        versionId: '10',
        body: { decision: 'publish' } as never,
        currentUser: adminUser,
        context,
      });

      expect(result.status).toBe('published');
      expect(result.publishedAt).not.toBeNull();
    });

    it('happy path: approve moves pending_approval -> approved', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'pending_approval' } as never);
      (repository.updateCatalogVersionStatus as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'approved' } as never);

      const result = await service.decideCatalogVersion({
        catalogCode: 'c1',
        versionId: '10',
        body: { decision: 'approve' } as never,
        currentUser: adminUser,
        context,
      });

      expect(result.status).toBe('approved');
      expect(result.publishedAt).toBeNull();
    });

    it('retire has no status precondition today: it is allowed even from draft — documents current behavior explicitly', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'draft' } as never);
      (repository.updateCatalogVersionStatus as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'retired' } as never);

      const result = await service.decideCatalogVersion({
        catalogCode: 'c1',
        versionId: '10',
        body: { decision: 'retire' } as never,
        currentUser: adminUser,
        context,
      });

      expect(result.status).toBe('retired');
    });

    it('reject has no status precondition today either, and maps to status "rejected"', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'pending_approval' } as never);
      (repository.updateCatalogVersionStatus as jest.Mock).mockResolvedValueOnce({ id: 10, status: 'rejected' } as never);

      const result = await service.decideCatalogVersion({
        catalogCode: 'c1',
        versionId: '10',
        body: { decision: 'reject' } as never,
        currentUser: adminUser,
        context,
      });

      const statusArgs = (repository.updateCatalogVersionStatus as jest.Mock).mock.calls[0][1] as { status: string };
      expect(statusArgs.status).toBe('rejected');
      expect(result.status).toBe('rejected');
    });

    it('throws NotFoundException when the version does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findCatalogByCode as jest.Mock).mockResolvedValueOnce({ id: 1 } as never);
      (repository.findCatalogVersion as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        service.decideCatalogVersion({
          catalogCode: 'c1',
          versionId: 'missing',
          body: { decision: 'approve' } as never,
          currentUser: adminUser,
          context,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
