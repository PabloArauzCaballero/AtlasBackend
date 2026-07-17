import { describe, expect, it, jest } from '@jest/globals';
import { CatalogRiskPolicyRepository } from '../../../src/modules/catalog-management/catalog-risk-policy.repository.js';

/**
 * `CatalogRiskPolicyRepository` se extrajo de la fachada (Fase 2.3) para que el agregado de política
 * de riesgo toque solo sus 4 tablas. Verifica las lecturas/escrituras clave sin pasar por la fachada.
 */
describe('CatalogRiskPolicyRepository', () => {
  function buildRepo() {
    const models = {
      riskModelVersionModel: { findAll: jest.fn(async () => []), create: jest.fn() },
      riskRulesetVersionModel: {
        findAll: jest.fn(async () => []),
        create: jest.fn(),
        findOne: jest.fn(),
        update: jest.fn(async () => [0]),
      },
      riskPolicyRuleModel: { findAll: jest.fn(async () => []), create: jest.fn() },
      riskSignalSeedModel: { findAll: jest.fn(async () => []), create: jest.fn() },
    };
    const repo = new CatalogRiskPolicyRepository(
      models.riskModelVersionModel as never,
      models.riskRulesetVersionModel as never,
      models.riskPolicyRuleModel as never,
      models.riskSignalSeedModel as never,
    );
    return { repo, models };
  }

  it('listCurrentRiskPolicy consulta modelo, ruleset y semillas activas', async () => {
    const { repo, models } = buildRepo();
    const result = await repo.listCurrentRiskPolicy();
    expect(models.riskModelVersionModel.findAll).toHaveBeenCalledTimes(1);
    expect(models.riskRulesetVersionModel.findAll).toHaveBeenCalledTimes(1);
    expect(models.riskSignalSeedModel.findAll).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ modelVersions: [], rulesetVersions: [], riskSignalSeeds: [] });
  });

  it('findRulesByRulesetIds corta temprano (sin query) cuando la lista está vacía', async () => {
    const { repo, models } = buildRepo();
    const result = await repo.findRulesByRulesetIds([]);
    expect(result).toEqual([]);
    expect(models.riskPolicyRuleModel.findAll).not.toHaveBeenCalled();
  });

  it('activateRuleset marca el ruleset activo y lo guarda en la transacción', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({ saved: true }));
    const version = { save } as never;
    const now = new Date('2026-01-01');

    await repo.activateRuleset(version, { approvedByPlatformUserId: 'p1', effectiveFrom: now, now }, { transaction: 'tx' as never });

    expect((version as { status: string }).status).toBe('active');
    expect((version as { approvedByPlatformUserId: string }).approvedByPlatformUserId).toBe('p1');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('retireOtherActiveRulesets no hace nada si rulesetCode es null', async () => {
    const { repo, models } = buildRepo();
    const count = await repo.retireOtherActiveRulesets(null, 'r1', new Date(), {});
    expect(count).toBe(0);
    expect(models.riskRulesetVersionModel.update).not.toHaveBeenCalled();
  });

  it('retireOtherActiveRulesets retira los otros rulesets activos del mismo código', async () => {
    const { repo, models } = buildRepo();
    (models.riskRulesetVersionModel.update as jest.Mock).mockResolvedValueOnce([3] as never);
    const count = await repo.retireOtherActiveRulesets('RS-1', 'current', new Date('2026-01-01'), {});
    expect(count).toBe(3);
    expect(models.riskRulesetVersionModel.update).toHaveBeenCalledTimes(1);
  });
});
