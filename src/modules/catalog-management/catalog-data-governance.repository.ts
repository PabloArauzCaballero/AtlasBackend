import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import {
  DataClassificationPolicyModel,
  DataProviderModel,
  DataQualityRuleModel,
  PrivacyProcessingPurposeModel,
  RetentionPolicyModel,
  SensitiveFieldRuleModel,
} from '../../database/models/index.js';
import { RepositoryOptions, upsertByCode } from './catalog-repository.helpers.js';

/**
 * Repositorio del agregado de GOBIERNO DE DATOS de catalog-management (Fase 2.3 del plan 10/10):
 * propósitos de privacidad, políticas de retención, proveedores de datos, políticas de
 * clasificación, reglas de campos sensibles y reglas de calidad de datos. Toca EXCLUSIVAMENTE las 6
 * tablas de su agregado — no tiene acceso al resto del esquema de catálogo, riesgo o auditoría.
 * `CatalogManagementRepository` delega en este repo para mantener su API pública.
 */
@Injectable()
export class CatalogDataGovernanceRepository {
  constructor(
    @InjectModel(PrivacyProcessingPurposeModel) private readonly privacyPurposeModel: typeof PrivacyProcessingPurposeModel,
    @InjectModel(RetentionPolicyModel) private readonly retentionPolicyModel: typeof RetentionPolicyModel,
    @InjectModel(DataProviderModel) private readonly dataProviderModel: typeof DataProviderModel,
    @InjectModel(DataClassificationPolicyModel) private readonly classificationPolicyModel: typeof DataClassificationPolicyModel,
    @InjectModel(SensitiveFieldRuleModel) private readonly sensitiveFieldRuleModel: typeof SensitiveFieldRuleModel,
    @InjectModel(DataQualityRuleModel) private readonly dataQualityRuleModel: typeof DataQualityRuleModel,
  ) {}

  async listDataGovernancePolicies() {
    const [privacyPurposes, retentionPolicies, dataProviders, classificationPolicies, sensitiveFieldRules, dataQualityRules] =
      await Promise.all([
        this.privacyPurposeModel.findAll({ where: { isActive: true }, order: [['purposeCode', 'ASC']] } as FindOptions),
        this.retentionPolicyModel.findAll({ where: { isActive: true }, order: [['policyCode', 'ASC']] } as FindOptions),
        this.dataProviderModel.findAll({ where: { isActive: true }, order: [['providerCode', 'ASC']] } as FindOptions),
        this.classificationPolicyModel.findAll({ order: [['classificationCode', 'ASC']] } as FindOptions),
        this.sensitiveFieldRuleModel.findAll({
          where: { isActive: true },
          order: [
            ['tableName', 'ASC'],
            ['fieldName', 'ASC'],
          ],
        } as FindOptions),
        this.dataQualityRuleModel.findAll({ where: { isActive: true }, order: [['ruleCode', 'ASC']] } as FindOptions),
      ]);
    return { privacyPurposes, retentionPolicies, dataProviders, classificationPolicies, sensitiveFieldRules, dataQualityRules };
  }

  upsertPrivacyPurpose(values: Record<string, unknown>, options: RepositoryOptions) {
    return upsertByCode(this.privacyPurposeModel, 'purposeCode', values.purposeCode as string, values, options);
  }
  upsertRetentionPolicy(values: Record<string, unknown>, options: RepositoryOptions) {
    return upsertByCode(this.retentionPolicyModel, 'policyCode', values.policyCode as string, values, options);
  }
  upsertDataProvider(values: Record<string, unknown>, options: RepositoryOptions) {
    return upsertByCode(this.dataProviderModel, 'providerCode', values.providerCode as string, values, options);
  }
  upsertClassificationPolicy(values: Record<string, unknown>, options: RepositoryOptions) {
    return upsertByCode(this.classificationPolicyModel, 'classificationCode', values.classificationCode as string, values, options);
  }
  upsertDataQualityRule(values: Record<string, unknown>, options: RepositoryOptions) {
    return upsertByCode(this.dataQualityRuleModel, 'ruleCode', values.ruleCode as string, values, options);
  }

  async upsertSensitiveFieldRule(values: Record<string, unknown>, options: RepositoryOptions) {
    const existing = await this.sensitiveFieldRuleModel.findOne({
      where: { tableName: values.tableName, fieldName: values.fieldName },
      transaction: options.transaction,
    } as FindOptions);
    if (existing) {
      await existing.update({ ...values, updatedAtValue: values.updatedAtValue }, { transaction: options.transaction });
      return { record: existing, created: false };
    }
    const record = await this.sensitiveFieldRuleModel.create(values as any, { transaction: options.transaction });
    return { record, created: true };
  }
}
