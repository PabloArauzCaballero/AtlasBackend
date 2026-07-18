import { describe, expect, it, jest } from '@jest/globals';
import { CatalogManagementRepository } from '../../../src/modules/catalog-management/catalog-management.repository.js';

/**
 * La fachada `CatalogManagementRepository` conserva la implementación real del núcleo del catálogo
 * (catálogos/versiones/ítems/aliases/mapeos de riesgo/fuentes/staging/aprobación/ingesta/auditoría)
 * y delega los agregados extraídos en la Fase 2.3 (definiciones, política de riesgo, gobierno de
 * datos) en sus repos por agregado. Este spec directo verifica ese núcleo y la delegación sin pasar
 * por los servicios que hoy la cubren de forma indirecta.
 */
describe('CatalogManagementRepository', () => {
  function buildRepo() {
    const models = {
      catalogModel: { findAll: jest.fn(async () => []), findOne: jest.fn(async () => null) },
      catalogVersionModel: { findOne: jest.fn(async () => null), findAll: jest.fn(async () => []), create: jest.fn(async () => ({})) },
      contextItemModel: { findAll: jest.fn(async () => []), create: jest.fn(async () => ({})) },
      contextItemAliasModel: { findAll: jest.fn(async () => []), create: jest.fn(async () => ({})) },
      contextRiskMappingModel: { findAll: jest.fn(async () => []), create: jest.fn(async () => ({})) },
      contextSourceModel: { findOne: jest.fn(async () => null), create: jest.fn(async () => ({})) },
      contextStagingItemModel: { findOne: jest.fn(async () => null), create: jest.fn(async () => ({})) },
      contextApprovalEventModel: { create: jest.fn(async () => ({})) },
      contextIngestionJobModel: { create: jest.fn(async () => ({})) },
      auditModel: { create: jest.fn(async () => ({})) },
      dataChangeLogModel: { create: jest.fn(async () => ({})) },
    };
    const subRepos = {
      dataGovernance: {
        listDataGovernancePolicies: jest.fn(async () => ({})),
        upsertPrivacyPurpose: jest.fn(),
        upsertRetentionPolicy: jest.fn(),
        upsertDataProvider: jest.fn(),
        upsertClassificationPolicy: jest.fn(),
        upsertDataQualityRule: jest.fn(),
        upsertSensitiveFieldRule: jest.fn(),
      },
      definitions: {
        listDefinitions: jest.fn(async () => ({})),
        upsertEventDefinition: jest.fn(),
        upsertObservationDefinition: jest.fn(),
        upsertAttributeDefinition: jest.fn(),
        upsertFeatureDefinition: jest.fn(),
      },
      riskPolicy: {
        listCurrentRiskPolicy: jest.fn(async () => ({})),
        findRulesByRulesetIds: jest.fn(async () => []),
        createRiskModelVersion: jest.fn(),
        createRiskRulesetVersion: jest.fn(),
        createRiskPolicyRule: jest.fn(),
        createRiskSignalSeed: jest.fn(),
        findRiskRulesetVersionById: jest.fn(),
        activateRuleset: jest.fn(),
        retireOtherActiveRulesets: jest.fn(),
      },
    };
    const repo = new CatalogManagementRepository(
      models.catalogModel as never,
      models.catalogVersionModel as never,
      models.contextItemModel as never,
      models.contextItemAliasModel as never,
      models.contextRiskMappingModel as never,
      models.contextSourceModel as never,
      models.contextStagingItemModel as never,
      models.contextApprovalEventModel as never,
      models.contextIngestionJobModel as never,
      models.auditModel as never,
      models.dataChangeLogModel as never,
      subRepos.dataGovernance as never,
      subRepos.definitions as never,
      subRepos.riskPolicy as never,
    );
    return { repo, models, subRepos };
  }

  const now = new Date('2026-01-01T00:00:00.000Z');

  // --- Núcleo del catálogo: lecturas -----------------------------------------------------------

  it('listCatalogs traduce domain/active a un where y ordena por catalogCode', async () => {
    const { repo, models } = buildRepo();
    await repo.listCatalogs({ domain: 'finance', active: 'true' } as never);
    expect(models.catalogModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { domain: 'finance', isActive: true }, order: [['catalogCode', 'ASC']] }),
    );
  });

  it('listCatalogs con active=false filtra por isActive:false y sin domain no añade la clave', async () => {
    const { repo, models } = buildRepo();
    await repo.listCatalogs({ active: 'false' } as never);
    expect(models.catalogModel.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: false } }));
  });

  it('findCatalogByCode busca por code propagando la transacción', async () => {
    const { repo, models } = buildRepo();
    await repo.findCatalogByCode('CAT-1', { transaction: 'tx' as never });
    expect(models.catalogModel.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { catalogCode: 'CAT-1' }, transaction: 'tx' }));
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
    await repo.createSource(
      { sourceCode: 'SRC-1', sourceName: 'Fuente', sourceType: 'manual', now },
      { transaction: 'tx' as never },
    );
    const [values, opts] = (models.contextSourceModel.create as jest.Mock).mock.calls[0] as [Record<string, unknown>, unknown];
    expect(values).toMatchObject({ sourceCode: 'SRC-1', sourceName: 'Fuente', sourceType: 'manual', isActive: true, reliabilityScore: null });
    expect(opts).toEqual({ transaction: 'tx' });
  });

  it('updateCatalogVersionStatus solo asigna los campos presentes y guarda en la transacción', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({ saved: true }));
    const version = { status: 'draft', notes: 'orig', approvedByType: 'x', save } as never;
    await repo.updateCatalogVersionStatus(version, { status: 'active', notes: 'nuevo' }, { transaction: 'tx' as never });
    const v = version as { status: string; notes: string; approvedByType: string };
    expect(v.status).toBe('active');
    expect(v.notes).toBe('nuevo');
    // approvedByType no venía en values => no debe tocarse
    expect(v.approvedByType).toBe('x');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('updateStagingItemDecision fija estado, notas y updatedAt y guarda', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({ saved: true }));
    const item = { save } as never;
    await repo.updateStagingItemDecision(item, { reviewStatus: 'approved', reviewNotes: 'ok', now }, {});
    const it2 = item as { reviewStatus: string; reviewNotes: string; updatedAtValue: Date };
    expect(it2.reviewStatus).toBe('approved');
    expect(it2.reviewNotes).toBe('ok');
    expect(it2.updatedAtValue).toBe(now);
    expect(save).toHaveBeenCalledWith({ transaction: undefined });
  });

  it('createAudit mapea el payload a payloadJson y copia occurredAt a createdAtValue', async () => {
    const { repo, models } = buildRepo();
    await repo.createAudit(
      {
        tenantId: 't1',
        actorType: 'internal_user',
        actorInternalUserId: 'u1',
        actorPlatformUserId: null,
        actionCode: 'CATALOG_PUBLISH',
        targetType: 'catalog',
        targetId: 'c1',
        ipAddress: null,
        userAgent: null,
        payload: { foo: 'bar' },
        occurredAt: now,
      },
      {},
    );
    const [values] = (models.auditModel.create as jest.Mock).mock.calls[0] as [Record<string, unknown>];
    expect(values).toMatchObject({ tenantId: 't1', actionCode: 'CATALOG_PUBLISH', payloadJson: { foo: 'bar' }, occurredAt: now, createdAtValue: now });
  });

  it('createDataChange hashea newValues cuando existen y deja null si no', async () => {
    const { repo, models } = buildRepo();
    const base = {
      tenantId: 't1',
      tableName: 'context_items',
      recordId: 'r1',
      changeType: 'update',
      actorType: 'internal_user',
      actorInternalUserId: 'u1',
      actorPlatformUserId: null,
      reason: 'fix',
      happenedAt: now,
    };
    await repo.createDataChange({ ...base, newValues: { a: 1 } }, {});
    await repo.createDataChange({ ...base }, {});
    const calls = (models.dataChangeLogModel.create as jest.Mock).mock.calls as Array<[Record<string, unknown>]>;
    expect(calls[0][0].newValuesHash).toEqual(expect.any(String));
    expect(calls[0][0].oldValuesHash).toBeNull();
    expect(calls[1][0].newValuesHash).toBeNull();
  });

  // --- Delegación a los repos por agregado (Fase 2.3) ------------------------------------------

  it('delega definiciones en CatalogDefinitionsRepository', async () => {
    const { repo, subRepos } = buildRepo();
    await repo.listDefinitions({} as never);
    repo.upsertEventDefinition({ a: 1 }, {});
    expect(subRepos.definitions.listDefinitions).toHaveBeenCalledTimes(1);
    expect(subRepos.definitions.upsertEventDefinition).toHaveBeenCalledWith({ a: 1 }, {});
  });

  it('delega política de riesgo en CatalogRiskPolicyRepository', async () => {
    const { repo, subRepos } = buildRepo();
    await repo.listCurrentRiskPolicy();
    await repo.findRulesByRulesetIds(['rs1']);
    expect(subRepos.riskPolicy.listCurrentRiskPolicy).toHaveBeenCalledTimes(1);
    expect(subRepos.riskPolicy.findRulesByRulesetIds).toHaveBeenCalledWith(['rs1']);
  });

  it('delega gobierno de datos en CatalogDataGovernanceRepository', async () => {
    const { repo, subRepos } = buildRepo();
    await repo.listDataGovernancePolicies();
    repo.upsertPrivacyPurpose({ p: 1 }, {});
    expect(subRepos.dataGovernance.listDataGovernancePolicies).toHaveBeenCalledTimes(1);
    expect(subRepos.dataGovernance.upsertPrivacyPurpose).toHaveBeenCalledWith({ p: 1 }, {});
  });
});
