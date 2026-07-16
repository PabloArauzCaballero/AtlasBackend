import { describe, expect, it, jest } from '@jest/globals';
import { CatalogDataGovernanceRepository } from '../../../src/modules/catalog-management/catalog-data-governance.repository.js';

/**
 * `CatalogDataGovernanceRepository` se extrajo de la fachada `CatalogManagementRepository` (Fase 2.3
 * del plan 10/10) para que el agregado de gobierno de datos toque EXCLUSIVAMENTE sus 6 tablas. Este
 * spec verifica ese acceso acotado directamente, sin pasar por la fachada.
 */
describe('CatalogDataGovernanceRepository', () => {
  function buildRepo() {
    const models = {
      privacyPurposeModel: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
      retentionPolicyModel: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
      dataProviderModel: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
      classificationPolicyModel: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
      sensitiveFieldRuleModel: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
      dataQualityRuleModel: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
    };
    const repo = new CatalogDataGovernanceRepository(
      models.privacyPurposeModel as never,
      models.retentionPolicyModel as never,
      models.dataProviderModel as never,
      models.classificationPolicyModel as never,
      models.sensitiveFieldRuleModel as never,
      models.dataQualityRuleModel as never,
    );
    return { repo, models };
  }

  describe('listDataGovernancePolicies', () => {
    it('reads all 6 governance tables in parallel and returns them keyed by concept', async () => {
      const { repo, models } = buildRepo();
      (models.privacyPurposeModel.findAll as jest.Mock).mockResolvedValue([{ id: 'pp' }] as never);
      (models.retentionPolicyModel.findAll as jest.Mock).mockResolvedValue([{ id: 'rp' }] as never);
      (models.dataProviderModel.findAll as jest.Mock).mockResolvedValue([{ id: 'dp' }] as never);
      (models.classificationPolicyModel.findAll as jest.Mock).mockResolvedValue([{ id: 'cp' }] as never);
      (models.sensitiveFieldRuleModel.findAll as jest.Mock).mockResolvedValue([{ id: 'sf' }] as never);
      (models.dataQualityRuleModel.findAll as jest.Mock).mockResolvedValue([{ id: 'dq' }] as never);

      const result = await repo.listDataGovernancePolicies();

      expect(result).toEqual({
        privacyPurposes: [{ id: 'pp' }],
        retentionPolicies: [{ id: 'rp' }],
        dataProviders: [{ id: 'dp' }],
        classificationPolicies: [{ id: 'cp' }],
        sensitiveFieldRules: [{ id: 'sf' }],
        dataQualityRules: [{ id: 'dq' }],
      });
    });
  });

  describe('upsertPrivacyPurpose (vía upsertByCode)', () => {
    it('updates the existing row when one matches the code, without creating', async () => {
      const { repo, models } = buildRepo();
      const existing = { update: jest.fn(async () => undefined) };
      (models.privacyPurposeModel.findOne as jest.Mock).mockResolvedValue(existing as never);

      const result = await repo.upsertPrivacyPurpose({ purposeCode: 'MARKETING' }, {});

      expect(result).toEqual({ record: existing, created: false });
      expect(existing.update).toHaveBeenCalled();
      expect(models.privacyPurposeModel.create).not.toHaveBeenCalled();
    });

    it('creates a new row when none matches the code', async () => {
      const { repo, models } = buildRepo();
      (models.privacyPurposeModel.findOne as jest.Mock).mockResolvedValue(null as never);
      (models.privacyPurposeModel.create as jest.Mock).mockResolvedValue({ id: 'new' } as never);

      const result = await repo.upsertPrivacyPurpose({ purposeCode: 'NEW' }, {});

      expect(result).toEqual({ record: { id: 'new' }, created: true });
    });
  });

  describe('upsertSensitiveFieldRule (upsert por tabla+campo, no por código)', () => {
    it('matches on tableName+fieldName and updates when it exists', async () => {
      const { repo, models } = buildRepo();
      const existing = { update: jest.fn(async () => undefined) };
      (models.sensitiveFieldRuleModel.findOne as jest.Mock).mockResolvedValue(existing as never);

      const result = await repo.upsertSensitiveFieldRule({ tableName: 'customers', fieldName: 'email' }, {});

      expect(result).toEqual({ record: existing, created: false });
      expect(models.sensitiveFieldRuleModel.create).not.toHaveBeenCalled();
    });

    it('creates when no rule exists for that tableName+fieldName', async () => {
      const { repo, models } = buildRepo();
      (models.sensitiveFieldRuleModel.findOne as jest.Mock).mockResolvedValue(null as never);
      (models.sensitiveFieldRuleModel.create as jest.Mock).mockResolvedValue({ id: 'sf-new' } as never);

      const result = await repo.upsertSensitiveFieldRule({ tableName: 'customers', fieldName: 'phone' }, {});

      expect(result).toEqual({ record: { id: 'sf-new' }, created: true });
    });
  });
});
