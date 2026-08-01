/**
 * @file Carga del ruleset de riesgo vigente y sus reglas.
 * @business La política de crédito es dato versionado y aprobado, no constantes en el código.
 * @system lee `risk_ruleset_versions` + `risk_policy_rules`; no evalúa nada.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { RiskPolicyRuleModel, RiskRulesetVersionModel } from '../../../database/models/index.js';
import { PolicyRule } from '../application/risk-ruleset-evaluator.js';

export type ActiveRuleset = {
  rulesetVersionId: string;
  rulesetCode: string;
  versionCode: string;
  rules: PolicyRule[];
};

@Injectable()
export class RiskPolicyRepository {
  constructor(
    @InjectModel(RiskRulesetVersionModel) private readonly rulesetModel: typeof RiskRulesetVersionModel,
    @InjectModel(RiskPolicyRuleModel) private readonly ruleModel: typeof RiskPolicyRuleModel,
  ) {}

  /**
   * Ruleset activo para un tipo de evaluación, con su ventana de vigencia respetada.
   *
   * Devuelve `null` cuando no hay ninguno: el servicio degrada a la heurística en vez de bloquear el
   * onboarding. Una instalación sin política cargada tiene que poder operar; lo que no puede es
   * creer que está aplicando una política cuando no hay ninguna.
   */
  async findActiveRuleset(assessmentType: string, now: Date): Promise<ActiveRuleset | null> {
    const version = await this.rulesetModel.findOne({
      where: {
        status: 'active',
        [Op.and]: [
          { [Op.or]: [{ assessmentType: null }, { assessmentType }] },
          { [Op.or]: [{ effectiveFrom: null }, { effectiveFrom: { [Op.lte]: now } }] },
          { [Op.or]: [{ effectiveUntil: null }, { effectiveUntil: { [Op.gt]: now } }] },
        ],
      },
      // Ante varias versiones activas gana la más reciente: es la que aprobó riesgo por última vez.
      order: [
        ['effectiveFrom', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);

    if (!version) return null;

    const rules = await this.ruleModel.findAll({
      where: { rulesetVersionId: version.id },
      order: [['id', 'ASC']],
    } as FindOptions);

    return {
      rulesetVersionId: String(version.id),
      rulesetCode: version.rulesetCode ?? 'unknown',
      versionCode: version.versionCode ?? 'unknown',
      rules: rules
        .filter((rule): rule is RiskPolicyRuleModel & { ruleCode: string } => typeof rule.ruleCode === 'string')
        .map((rule) => ({
          ruleCode: rule.ruleCode,
          ruleName: rule.ruleName,
          riskDimension: rule.riskDimension,
          severity: rule.severity,
          actionCode: rule.actionCode,
          reasonCode: rule.reasonCode,
          isHardStop: rule.isHardStop,
          expression: rule.expressionJson,
        })),
    };
  }
}
