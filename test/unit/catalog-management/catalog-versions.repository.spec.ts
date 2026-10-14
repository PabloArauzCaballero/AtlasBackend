import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { CatalogVersionsRepository } from '../../../src/modules/catalog-management/catalog-versions.repository.js';

/** Verifica el agregado catálogo-versión: lecturas, escrituras y finders con su filtro y transacción. */
describe('CatalogVersionsRepository', () => {
  function buildRepo() {
    const models = {
      catalogModel: { findAll: jest.fn(async (..._args: unknown[]) => []), findOne: jest.fn(async (..._args: unknown[]) => null) },
      catalogVersionModel: {
        findOne: jest.fn(async (..._args: unknown[]) => null),
        findAll: jest.fn(async (..._args: unknown[]) => []),
        create: jest.fn(async (..._args: unknown[]) => ({})),
      },
      contextItemModel: { findAll: jest.fn(async (..._args: unknown[]) => []), create: jest.fn(async (..._args: unknown[]) => ({})) },
      contextItemAliasModel: { findAll: jest.fn(async (..._args: unknown[]) => []), create: jest.fn(async (..._args: unknown[]) => ({})) },
      contextRiskMappingModel: {
        findAll: jest.fn(async (..._args: unknown[]) => []),
        create: jest.fn(async (..._args: unknown[]) => ({})),
      },
      contextSourceModel: { findOne: jest.fn(async (..._args: unknown[]) => null), create: jest.fn(async (..._args: unknown[]) => ({})) },
      contextApprovalEventModel: { create: jest.fn(async (..._args: unknown[]) => ({})) },
    };
    const repo = new CatalogVersionsRepository(
      models.catalogModel as never,
      models.catalogVersionModel as never,
      models.contextItemModel as never,
      models.contextItemAliasModel as never,
      models.contextRiskMappingModel as never,
      models.contextSourceModel as never,
      models.contextApprovalEventModel as never,
    );
    return { repo, models };
  }

  const now = new Date('2026-01-01T00:00:00.000Z');

  // --- Núcleo del catálogo: lecturas -----------------------------------------------------------

  it('listCatalogs pagina con findAndCountAll, ordena por catalogCode y devuelve summary con el mismo filtro', async () => {
    const { repo, models } = buildRepo();
    const catalogModel = models.catalogModel as unknown as Record<string, jest.Mock>;
    catalogModel.findAndCountAll = jest.fn(async (..._args: unknown[]) => ({ rows: [{ id: 'c1' }], count: 41 }));
    catalogModel.count = jest.fn(async (..._args: unknown[]) => 7);
    const result = await repo.listCatalogs({ domain: 'finance', active: 'true', status: 'all', page: 3, limit: 20 } as never);
    const args = catalogModel.findAndCountAll.mock.calls[0]?.[0] as {
      where: Record<symbol, unknown>;
      order: unknown;
      limit: number;
      offset: number;
    };
    expect(args).toMatchObject({ order: [['catalogCode', 'ASC']], limit: 20, offset: 40 });
    expect(args.where[Op.and]).toEqual([{ domain: 'finance' }, { isActive: true }]);
    expect(catalogModel.count).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ rows: [{ id: 'c1' }], total: 41, summary: { total: 41, active: 7, published: 7, withoutVersion: 7 } });
  });

  it('findCatalogByCode busca por code propagando la transacción', async () => {
    const { repo, models } = buildRepo();
    await repo.findCatalogByCode('CAT-1', { transaction: 'tx' as never });
    expect(models.catalogModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { catalogCode: 'CAT-1' }, transaction: 'tx' }),
    );
  });

  it('findLatestVersion ordena por validFrom/id descendente', async () => {
    const { repo, models } = buildRepo();
    await repo.findLatestVersion('cat-1');
    expect(models.catalogVersionModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { catalogId: 'cat-1' },
        order: [
          ['validFrom', 'DESC'],
          ['id', 'DESC'],
        ],
      }),
    );
  });

  it('findLatestVersionsByCatalogIds corta temprano y no consulta con lista vacía', async () => {
    const { repo, models } = buildRepo();
    const result = await repo.findLatestVersionsByCatalogIds([]);
    expect(result.size).toBe(0);
    expect(models.catalogVersionModel.findAll).not.toHaveBeenCalled();
  });

  it('findLatestVersionsByCatalogIds conserva la primera (más reciente) versión por catálogo', async () => {
    const { repo, models } = buildRepo();
    (models.catalogVersionModel.findAll as jest.Mock).mockResolvedValueOnce([
      { catalogId: 'c1', id: 'v2' },
      { catalogId: 'c1', id: 'v1' },
      { catalogId: 'c2', id: 'v9' },
    ] as never);
    const result = await repo.findLatestVersionsByCatalogIds(['c1', 'c2']);
    expect(result.size).toBe(2);
    expect(result.get('c1')).toEqual({ catalogId: 'c1', id: 'v2' });
    expect(result.get('c2')).toEqual({ catalogId: 'c2', id: 'v9' });
  });

  it('findAliasesByItemIds corta temprano (sin query) cuando la lista está vacía', async () => {
    const { repo, models } = buildRepo();
    const result = await repo.findAliasesByItemIds([]);
    expect(result).toEqual([]);
    expect(models.contextItemAliasModel.findAll).not.toHaveBeenCalled();
  });

  it('findRiskMappingsByItemIds corta temprano (sin query) cuando la lista está vacía', async () => {
    const { repo, models } = buildRepo();
    const result = await repo.findRiskMappingsByItemIds([]);
    expect(result).toEqual([]);
    expect(models.contextRiskMappingModel.findAll).not.toHaveBeenCalled();
  });

  it('findItemsByVersion filtra por catalogVersionId y ordena por itemCode', async () => {
    const { repo, models } = buildRepo();
    await repo.findItemsByVersion('ver-1', { transaction: 'tx' as never });
    expect(models.contextItemModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { catalogVersionId: 'ver-1' }, order: [['itemCode', 'ASC']], transaction: 'tx' }),
    );
  });

  it('findRiskMappingsByItemIds consulta el modelo cuando la lista no está vacía', async () => {
    const { repo, models } = buildRepo();
    await repo.findRiskMappingsByItemIds(['i1', 'i2']);
    expect(models.contextRiskMappingModel.findAll).toHaveBeenCalledTimes(1);
  });

  // --- Núcleo del catálogo: escrituras ---------------------------------------------------------

  it('createSource crea la fuente con isActive por defecto y timestamps', async () => {
    const { repo, models } = buildRepo();
    await repo.createSource({ sourceCode: 'SRC-1', sourceName: 'Fuente', sourceType: 'manual', now }, { transaction: 'tx' as never });
    const [values, opts] = (models.contextSourceModel.create as jest.Mock).mock.calls[0] as [Record<string, unknown>, unknown];
    expect(values).toMatchObject({
      sourceCode: 'SRC-1',
      sourceName: 'Fuente',
      sourceType: 'manual',
      isActive: true,
      reliabilityScore: null,
    });
    expect(opts).toEqual({ transaction: 'tx' });
  });

  it('updateCatalogVersionStatus solo asigna los campos presentes y guarda en la transacción', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async (..._args: unknown[]) => ({ saved: true }));
    const version = { status: 'draft', notes: 'orig', approvedByType: 'x', save } as never;
    await repo.updateCatalogVersionStatus(version, { status: 'active', notes: 'nuevo' }, { transaction: 'tx' as never });
    const v = version as { status: string; notes: string; approvedByType: string };
    expect(v.status).toBe('active');
    expect(v.notes).toBe('nuevo');
    // approvedByType no venía en values => no debe tocarse
    expect(v.approvedByType).toBe('x');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('los create* del núcleo delegan en model.create con {transaction} y campos mapeados', async () => {
    const { repo, models } = buildRepo();
    const opt = { transaction: 'tx' as never };
    await repo.createCatalogVersion(
      {
        catalogId: 'c',
        versionCode: 'v1',
        status: 'draft',
        validFrom: null,
        validUntil: null,
        createdByType: 'platform_admin',
        createdByPlatformUserId: 'u',
        notes: null,
        now,
      } as never,
      opt,
    );
    expect((models.catalogVersionModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      versionCode: 'v1',
      approvedByType: null,
      approvedAt: null,
    });
    expect((models.catalogVersionModel.create as jest.Mock).mock.calls[0][1]).toEqual({ transaction: 'tx' });

    await repo.createContextItem(
      {
        catalogVersionId: 'cv',
        itemCode: 'i',
        itemName: 'N',
        itemType: 't',
        attributes: { a: 1 },
        sourceId: null,
        confidenceScore: null,
        now,
      } as never,
      opt,
    );
    expect((models.contextItemModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      itemCode: 'i',
      attributesJson: { a: 1 },
      isActive: true,
    });

    await repo.createAlias(
      { contextItemId: 'ci', aliasValue: 'a', aliasType: 'syn', normalizedAlias: 'a', confidenceScore: null, now } as never,
      opt,
    );
    expect((models.contextItemAliasModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ aliasValue: 'a', normalizedAlias: 'a' });

    await repo.createRiskMapping(
      {
        contextItemId: 'ci',
        riskDimension: 'd',
        riskBand: 'HIGH',
        scorePointsSuggested: null,
        reasonCode: 'R',
        explanation: null,
        modelUsage: null,
        validFrom: null,
        validUntil: null,
        now,
      } as never,
      opt,
    );
    expect((models.contextRiskMappingModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ riskBand: 'HIGH', reasonCode: 'R' });

    await repo.createApprovalEvent(
      {
        stagingItemId: 's',
        catalogVersionId: 'cv',
        eventType: 'approved',
        decidedByPlatformUserId: 'u',
        decidedAt: now,
        decisionReason: 'ok',
      } as never,
      opt,
    );
    expect((models.contextApprovalEventModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      eventType: 'approved',
      createdAtValue: now,
    });
  });

  it('finders de versión y fuente delegan con su filtro y transacción', async () => {
    const { repo, models } = buildRepo();
    await repo.findCatalogVersion('c', 'v', { transaction: 'tx' as never });
    expect((models.catalogVersionModel.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { id: 'v', catalogId: 'c' },
      transaction: 'tx',
    });
    await repo.findCatalogVersionById('v2');
    expect((models.catalogVersionModel.findOne as jest.Mock).mock.calls[1][0]).toMatchObject({ where: { id: 'v2' } });
    await repo.findSourceByCode('SRC');
  });
});
