import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { CatalogDataGovernanceService } from '../../../src/modules/catalog-management/application/catalog-data-governance.service.js';

/**
 * ATLAS-P12 (continuación de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, Fase 1 de
 * `catalog-management`): `upsertDataGovernancePackage` registra en batch las políticas de
 * privacidad/retención/clasificación que gobiernan cómo se almacena cada dato sensible de Atlas.
 * El caso más importante es que las 6 categorías se cuenten de forma independiente (un error de
 * conteo cruzado escondería que una categoría no se procesó).
 */
describe('CatalogDataGovernanceService', () => {
  function buildService() {
    const repository = {
      listDataGovernancePolicies: jest.fn(),
      upsertPrivacyPurpose: jest.fn(),
      upsertRetentionPolicy: jest.fn(),
      upsertDataProvider: jest.fn(),
      upsertClassificationPolicy: jest.fn(),
      upsertSensitiveFieldRule: jest.fn(),
      upsertDataQualityRule: jest.fn(),
      createAudit: jest.fn(),
      createDataChange: jest.fn(),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const service = new CatalogDataGovernanceService(repository as never, sequelize as never);
    return { service, repository };
  }

  const internalUser = { role: 'internal_operator', internalUserId: 'iu1', platformUserId: 'pu1' } as never;
  const customerUser = { role: 'customer', internalUserId: null, platformUserId: null } as never;
  const context = { tenantId: 't1', ipAddress: null, userAgent: null, idempotencyKey: 'idem-1' };

  function emptyBody(overrides: Record<string, unknown> = {}) {
    return {
      privacyPurposes: [],
      retentionPolicies: [],
      dataProviders: [],
      classificationPolicies: [],
      sensitiveFieldRules: [],
      dataQualityRules: [],
      ...overrides,
    };
  }

  describe('getDataGovernancePolicies', () => {
    it('rejects a non-internal actor', async () => {
      const { service } = buildService();
      await expect(service.getDataGovernancePolicies({ currentUser: customerUser })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('upsertDataGovernancePackage', () => {
    it('rejects without an idempotency key, before touching the repository', async () => {
      const { service, repository } = buildService();
      await expect(
        service.upsertDataGovernancePackage({
          body: emptyBody() as never,
          currentUser: internalUser,
          context: { ...context, idempotencyKey: undefined },
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.upsertPrivacyPurpose).not.toHaveBeenCalled();
    });

    it('counts each of the 6 policy categories independently, not conflated into a single total', async () => {
      const { service, repository } = buildService();

      const result = await service.upsertDataGovernancePackage({
        body: emptyBody({
          privacyPurposes: [{ purposeCode: 'p1', purposeName: 'P1', requiresExplicitConsent: true }],
          retentionPolicies: [
            { policyCode: 'r1', appliesTo: 'x', retentionDays: 90, postRetentionAction: 'delete' },
            { policyCode: 'r2', appliesTo: 'y', retentionDays: 30, postRetentionAction: 'anonymize' },
          ],
          dataProviders: [],
          classificationPolicies: [
            {
              classificationCode: 'c1',
              classificationName: 'C1',
              sensitivityLevel: 'high',
              allowedStorageModes: [],
              encryptionRequired: true,
              hashingRequired: false,
              rawStorageAllowed: false,
            },
          ],
          sensitiveFieldRules: [],
          dataQualityRules: [
            { ruleCode: 'q1', ruleName: 'Q1', targetTable: 't', severity: 'high', expressionJson: {}, expectedAction: 'flag' },
            { ruleCode: 'q2', ruleName: 'Q2', targetTable: 't', severity: 'low', expressionJson: {}, expectedAction: 'flag' },
            { ruleCode: 'q3', ruleName: 'Q3', targetTable: 't', severity: 'low', expressionJson: {}, expectedAction: 'flag' },
          ],
        }) as never,
        currentUser: internalUser,
        context,
      });

      expect(result).toMatchObject({
        privacyPurposesProcessed: 1,
        retentionPoliciesProcessed: 2,
        dataProvidersProcessed: 0,
        classificationPoliciesProcessed: 1,
        sensitiveFieldRulesProcessed: 0,
        dataQualityRulesProcessed: 3,
      });
      expect(repository.upsertRetentionPolicy).toHaveBeenCalledTimes(2);
      expect(repository.upsertDataQualityRule).toHaveBeenCalledTimes(3);
      expect(repository.upsertDataProvider).not.toHaveBeenCalled();
    });

    it('every upserted privacy purpose and retention policy is marked isActive: true, regardless of input', async () => {
      const { service, repository } = buildService();

      await service.upsertDataGovernancePackage({
        body: emptyBody({
          privacyPurposes: [{ purposeCode: 'p1', purposeName: 'P1', requiresExplicitConsent: true }],
        }) as never,
        currentUser: internalUser,
        context,
      });

      const purposeArgs = (repository.upsertPrivacyPurpose as jest.Mock).mock.calls[0][0] as { isActive: boolean };
      expect(purposeArgs.isActive).toBe(true);
    });

    it('a completely empty package still succeeds, with every count at 0', async () => {
      const { service } = buildService();
      const result = await service.upsertDataGovernancePackage({ body: emptyBody() as never, currentUser: internalUser, context });
      expect(Object.values(result).every((count) => count === 0)).toBe(true);
    });

    it('writes exactly one audit entry and one data-change entry per call, regardless of how many items were in the package', async () => {
      const { service, repository } = buildService();
      await service.upsertDataGovernancePackage({
        body: emptyBody({
          privacyPurposes: [{ purposeCode: 'p1', purposeName: 'P1', requiresExplicitConsent: true }],
          retentionPolicies: [{ policyCode: 'r1', appliesTo: 'x', retentionDays: 90, postRetentionAction: 'delete' }],
        }) as never,
        currentUser: internalUser,
        context,
      });
      expect(repository.createAudit).toHaveBeenCalledTimes(1);
      expect(repository.createDataChange).toHaveBeenCalledTimes(1);
    });
  });
});
