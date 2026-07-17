import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { RiskModelVersionModel, RiskPolicyRuleModel, RiskRulesetVersionModel, RiskSignalSeedModel } from '../../database/models/index.js';
import { RepositoryOptions } from './catalog-repository.helpers.js';

/**
 * Repositorio del agregado de POLÍTICA DE RIESGO de catalog-management (Fase 2.3 del plan 10/10):
 * versiones de modelo/ruleset de riesgo, reglas de política y semillas de señales, más la activación
 * y retiro de rulesets. Toca EXCLUSIVAMENTE sus 4 tablas — sin acceso al resto del esquema de
 * catálogo, definiciones, gobierno o auditoría. `CatalogManagementRepository` delega en este repo.
 */
@Injectable()
export class CatalogRiskPolicyRepository {
  constructor(
    @InjectModel(RiskModelVersionModel) private readonly riskModelVersionModel: typeof RiskModelVersionModel,
    @InjectModel(RiskRulesetVersionModel) private readonly riskRulesetVersionModel: typeof RiskRulesetVersionModel,
    @InjectModel(RiskPolicyRuleModel) private readonly riskPolicyRuleModel: typeof RiskPolicyRuleModel,
    @InjectModel(RiskSignalSeedModel) private readonly riskSignalSeedModel: typeof RiskSignalSeedModel,
  ) {}

  async listCurrentRiskPolicy() {
    const [modelVersions, rulesetVersions, riskSignalSeeds] = await Promise.all([
      this.riskModelVersionModel.findAll({
        where: { status: { [Op.in]: ['active', 'published'] } },
        order: [
          ['effectiveFrom', 'DESC'],
          ['id', 'DESC'],
        ],
      } as FindOptions),
      this.riskRulesetVersionModel.findAll({
        where: { status: { [Op.in]: ['active', 'published'] } },
        order: [
          ['effectiveFrom', 'DESC'],
          ['id', 'DESC'],
        ],
      } as FindOptions),
      this.riskSignalSeedModel.findAll({
        where: { isActive: true },
        order: [
          ['priority', 'ASC'],
          ['signalCode', 'ASC'],
        ],
      } as FindOptions),
    ]);
    return { modelVersions, rulesetVersions, riskSignalSeeds };
  }

  findRulesByRulesetIds(rulesetVersionIds: string[]): Promise<RiskPolicyRuleModel[]> {
    if (rulesetVersionIds.length === 0) return Promise.resolve([]);
    return this.riskPolicyRuleModel.findAll({
      where: { rulesetVersionId: { [Op.in]: rulesetVersionIds } },
      order: [['ruleCode', 'ASC']],
    } as FindOptions);
  }

  createRiskModelVersion(values: Record<string, unknown>, options: RepositoryOptions): Promise<RiskModelVersionModel> {
    return this.riskModelVersionModel.create(values as never, { transaction: options.transaction });
  }
  createRiskRulesetVersion(values: Record<string, unknown>, options: RepositoryOptions): Promise<RiskRulesetVersionModel> {
    return this.riskRulesetVersionModel.create(values as never, { transaction: options.transaction });
  }
  createRiskPolicyRule(values: Record<string, unknown>, options: RepositoryOptions): Promise<RiskPolicyRuleModel> {
    return this.riskPolicyRuleModel.create(values as never, { transaction: options.transaction });
  }
  createRiskSignalSeed(values: Record<string, unknown>, options: RepositoryOptions): Promise<RiskSignalSeedModel> {
    return this.riskSignalSeedModel.create(values as never, { transaction: options.transaction });
  }

  findRiskRulesetVersionById(id: string, options: RepositoryOptions = {}): Promise<RiskRulesetVersionModel | null> {
    return this.riskRulesetVersionModel.findOne({ where: { id }, transaction: options.transaction } as FindOptions);
  }

  async activateRuleset(
    version: RiskRulesetVersionModel,
    values: { approvedByPlatformUserId: string | null; effectiveFrom: Date; now: Date },
    options: RepositoryOptions,
  ): Promise<RiskRulesetVersionModel> {
    version.status = 'active';
    version.effectiveFrom = values.effectiveFrom;
    version.approvedByPlatformUserId = values.approvedByPlatformUserId;
    version.approvedAt = values.now;
    return version.save({ transaction: options.transaction });
  }

  async retireOtherActiveRulesets(
    rulesetCode: string | null,
    currentId: string,
    effectiveUntil: Date,
    options: RepositoryOptions,
  ): Promise<number> {
    if (!rulesetCode) return 0;
    const [count] = await this.riskRulesetVersionModel.update({ status: 'retired', effectiveUntil } as never, {
      where: { rulesetCode, id: { [Op.ne]: currentId }, status: 'active' },
      transaction: options.transaction,
    });
    return count;
  }
}
