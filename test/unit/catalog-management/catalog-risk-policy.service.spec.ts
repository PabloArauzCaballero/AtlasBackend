import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CatalogRiskPolicyService } from '../../../src/modules/catalog-management/application/catalog-risk-policy.service.js';

/**
 * ATLAS-P12 (continuación de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, Fase 1 de
 * `catalog-management`): `CatalogRiskPolicyService` gobierna qué versión de reglas de riesgo
 * está activa — esto decide directamente qué reglas se aplican a una evaluación de crédito real.
 * `activateRiskRulesetVersion` es el método más importante: activar la versión equivocada, o
 * activarla sin retirar la anterior, tiene consecuencias de negocio directas.
 */
describe('CatalogRiskPolicyService', () => {
  function buildTransactionMock() {
    return jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({}));
  }

  function buildService() {
    const repository = {
      listCurrentRiskPolicy: jest.fn(),
      findRulesByRulesetIds: jest.fn(),
      createRiskModelVersion: jest.fn(),
      createRiskRulesetVersion: jest.fn(),
      createRiskPolicyRule: jest.fn(),
      createRiskSignalSeed: jest.fn(),
      createAudit: jest.fn(),
      createDataChange: jest.fn(),
      findRiskRulesetVersionById: jest.fn(),
      retireOtherActiveRulesets: jest.fn(),
      activateRuleset: jest.fn(),
    };
    const sequelize = { transaction: buildTransactionMock() };
    const service = new CatalogRiskPolicyService(repository as never, sequelize as never);
    return { service, repository };
  }

  const internalUser = { role: 'internal_operator', internalUserId: 'iu1', platformUserId: 'pu1' } as never;
  const adminUser = { role: 'admin', internalUserId: 'iu1', platformUserId: 'pu1' } as never;
  const customerUser = { role: 'customer', internalUserId: null, platformUserId: null } as never;
  const context = { tenantId: 't1', ipAddress: null, userAgent: null, idempotencyKey: 'idem-1' };

  describe('getCurrentRiskPolicy', () => {
    it('rejects a non-internal actor', async () => {
      const { service } = buildService();
      await expect(service.getCurrentRiskPolicy({ currentUser: customerUser })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createRiskRulesetVersion', () => {
    it('rejects without an idempotency key', async () => {
      const { service, repository } = buildService();
      await expect(
        service.createRiskRulesetVersion({
          body: { modelVersion: {}, ruleset: {}, rules: [], riskSignalSeeds: [] } as never,
          currentUser: internalUser,
          context: { ...context, idempotencyKey: undefined },
        }),
      ).rejects.toThrow(/Idempotency/);
      expect(repository.createRiskModelVersion).not.toHaveBeenCalled();
    });

    it('creates a rule and a signal seed for every entry given, reporting accurate counts', async () => {
      const { service, repository } = buildService();
      (repository.createRiskModelVersion as jest.Mock).mockResolvedValueOnce({ id: 'mv-1' } as never);
      (repository.createRiskRulesetVersion as jest.Mock).mockResolvedValueOnce({
        id: 'rv-1',
        status: 'draft',
        rulesetCode: 'core',
        versionCode: 'v1',
      } as never);

      const result = await service.createRiskRulesetVersion({
        body: {
          modelVersion: { modelCode: 'm1', versionCode: 'v1', modelType: 'scorecard', assessmentType: 'origination', status: 'draft' },
          ruleset: { rulesetCode: 'core', versionCode: 'v1', assessmentType: 'origination', status: 'draft' },
          rules: [
            {
              ruleCode: 'r1',
              ruleName: 'Rule 1',
              riskDimension: 'd',
              ruleType: 'hard_stop',
              severity: 'high',
              expressionJson: {},
              actionCode: 'a',
              reasonCode: 'r',
              isHardStop: true,
            },
            {
              ruleCode: 'r2',
              ruleName: 'Rule 2',
              riskDimension: 'd',
              ruleType: 'scoring',
              severity: 'low',
              expressionJson: {},
              actionCode: 'a',
              reasonCode: 'r',
              isHardStop: false,
            },
          ],
          riskSignalSeeds: [{ signalCode: 's1', signalName: 'Signal 1', signalType: 'numeric', sourceEntity: 'customer', exampleValue: 1 }],
        } as never,
        currentUser: internalUser,
        context,
      });

      expect(repository.createRiskPolicyRule).toHaveBeenCalledTimes(2);
      expect(repository.createRiskSignalSeed).toHaveBeenCalledTimes(1);
      expect(result.rulesCreated).toBe(2);
      expect(result.riskSignalSeedsCreated).toBe(1);
    });

    it('every risk signal seed is created active: true, regardless of input', async () => {
      const { service, repository } = buildService();
      (repository.createRiskModelVersion as jest.Mock).mockResolvedValueOnce({ id: 'mv-1' } as never);
      (repository.createRiskRulesetVersion as jest.Mock).mockResolvedValueOnce({
        id: 'rv-1',
        status: 'draft',
        rulesetCode: 'core',
        versionCode: 'v1',
      } as never);

      await service.createRiskRulesetVersion({
        body: {
          modelVersion: { modelCode: 'm1', versionCode: 'v1', modelType: 'scorecard', assessmentType: 'origination', status: 'draft' },
          ruleset: { rulesetCode: 'core', versionCode: 'v1', assessmentType: 'origination', status: 'draft' },
          rules: [],
          riskSignalSeeds: [{ signalCode: 's1', signalName: 'Signal 1', signalType: 'numeric', sourceEntity: 'customer', exampleValue: 1 }],
        } as never,
        currentUser: internalUser,
        context,
      });

      const seedArgs = (repository.createRiskSignalSeed as jest.Mock).mock.calls[0][0] as { isActive: boolean };
      expect(seedArgs.isActive).toBe(true);
    });
  });

  describe('activateRiskRulesetVersion', () => {
    it('rejects a non-admin internal actor before touching the repository — only admin/platform_admin may activate', async () => {
      const { service, repository } = buildService();
      await expect(
        service.activateRiskRulesetVersion({ rulesetVersionId: 'rv-1', body: {} as never, currentUser: internalUser, context }),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.findRiskRulesetVersionById).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the ruleset version does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findRiskRulesetVersionById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        service.activateRiskRulesetVersion({ rulesetVersionId: 'missing', body: {} as never, currentUser: adminUser, context }),
      ).rejects.toThrow(NotFoundException);
    });

    it.each(['draft', 'inactive', 'approved'])('allows activation from status "%s"', async (status) => {
      const { service, repository } = buildService();
      (repository.findRiskRulesetVersionById as jest.Mock).mockResolvedValueOnce({ id: 'rv-1', status, rulesetCode: 'core' } as never);
      (repository.retireOtherActiveRulesets as jest.Mock).mockResolvedValueOnce(1 as never);
      (repository.activateRuleset as jest.Mock).mockResolvedValueOnce({ id: 'rv-1', status: 'active', effectiveFrom: new Date() } as never);

      const result = await service.activateRiskRulesetVersion({
        rulesetVersionId: 'rv-1',
        body: {} as never,
        currentUser: adminUser,
        context,
      });

      expect(result.status).toBe('active');
    });

    it.each(['active', 'retired', 'rejected'])('throws RULESET_VERSION_NOT_ACTIVATABLE from status "%s"', async (status) => {
      const { service, repository } = buildService();
      (repository.findRiskRulesetVersionById as jest.Mock).mockResolvedValueOnce({ id: 'rv-1', status, rulesetCode: 'core' } as never);
      await expect(
        service.activateRiskRulesetVersion({ rulesetVersionId: 'rv-1', body: {} as never, currentUser: adminUser, context }),
      ).rejects.toThrow(/RULESET_VERSION_NOT_ACTIVATABLE/);
      expect(repository.activateRuleset).not.toHaveBeenCalled();
    });

    it('retires other active rulesets of the same rulesetCode BEFORE reporting success, and reports how many were retired', async () => {
      const { service, repository } = buildService();
      (repository.findRiskRulesetVersionById as jest.Mock).mockResolvedValueOnce({
        id: 'rv-2',
        status: 'approved',
        rulesetCode: 'core',
      } as never);
      (repository.retireOtherActiveRulesets as jest.Mock).mockResolvedValueOnce(1 as never);
      (repository.activateRuleset as jest.Mock).mockResolvedValueOnce({ id: 'rv-2', status: 'active', effectiveFrom: new Date() } as never);

      const result = await service.activateRiskRulesetVersion({
        rulesetVersionId: 'rv-2',
        body: {} as never,
        currentUser: adminUser,
        context,
      });

      expect(repository.retireOtherActiveRulesets).toHaveBeenCalledWith('core', 'rv-2', expect.any(Date), { transaction: {} });
      expect(result.retiredPreviousActiveRulesets).toBe(1);
    });

    it('defaults effectiveFrom to "now" when the caller does not supply one', async () => {
      const { service, repository } = buildService();
      (repository.findRiskRulesetVersionById as jest.Mock).mockResolvedValueOnce({
        id: 'rv-1',
        status: 'draft',
        rulesetCode: 'core',
      } as never);
      (repository.retireOtherActiveRulesets as jest.Mock).mockResolvedValueOnce(0 as never);
      (repository.activateRuleset as jest.Mock).mockResolvedValueOnce({ id: 'rv-1', status: 'active', effectiveFrom: new Date() } as never);

      const before = Date.now();
      await service.activateRiskRulesetVersion({ rulesetVersionId: 'rv-1', body: {} as never, currentUser: adminUser, context });
      const after = Date.now();

      const activateArgs = (repository.activateRuleset as jest.Mock).mock.calls[0][1] as { effectiveFrom: Date };
      expect(activateArgs.effectiveFrom.getTime()).toBeGreaterThanOrEqual(before);
      expect(activateArgs.effectiveFrom.getTime()).toBeLessThanOrEqual(after);
    });

    it('uses an explicit effectiveFrom when the caller supplies one, instead of "now"', async () => {
      const { service, repository } = buildService();
      (repository.findRiskRulesetVersionById as jest.Mock).mockResolvedValueOnce({
        id: 'rv-1',
        status: 'draft',
        rulesetCode: 'core',
      } as never);
      (repository.retireOtherActiveRulesets as jest.Mock).mockResolvedValueOnce(0 as never);
      (repository.activateRuleset as jest.Mock).mockResolvedValueOnce({
        id: 'rv-1',
        status: 'active',
        effectiveFrom: new Date('2026-08-01'),
      } as never);

      await service.activateRiskRulesetVersion({
        rulesetVersionId: 'rv-1',
        body: { effectiveFrom: '2026-08-01T00:00:00.000Z' } as never,
        currentUser: adminUser,
        context,
      });

      const activateArgs = (repository.activateRuleset as jest.Mock).mock.calls[0][1] as { effectiveFrom: Date };
      expect(activateArgs.effectiveFrom.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    });
  });
});
