import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'feature_definitions', timestamps: false })
export class FeatureDefinitionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'feature_code', type: DataType.STRING(120) })
  declare featureCode: string | null;

  @Column({ field: 'feature_name', type: DataType.STRING(180) })
  declare featureName: string | null;

  @Column({ field: 'feature_family', type: DataType.STRING(80) })
  declare featureFamily: string | null;

  @Column({ field: 'risk_dimension', type: DataType.STRING(60) })
  declare riskDimension: string | null;

  @Column({ field: 'data_type', type: DataType.STRING(40) })
  declare dataType: string | null;

  @Column({ field: 'availability_tier', type: DataType.STRING(40) })
  declare availabilityTier: string | null;

  @Column({ field: 'build_phase', type: DataType.STRING(40) })
  declare buildPhase: string | null;

  @Column({ field: 'data_classification_code', type: DataType.STRING(80) })
  declare dataClassificationCode: string | null;

  @Column({ field: 'calculation_kind', type: DataType.STRING(60) })
  declare calculationKind: string | null;

  @Column({ field: 'default_missing_strategy', type: DataType.STRING(80) })
  declare defaultMissingStrategy: string | null;

  @Column({ field: 'is_model_input', type: DataType.BOOLEAN })
  declare isModelInput: boolean | null;

  @Column({ field: 'is_policy_rule_input', type: DataType.BOOLEAN })
  declare isPolicyRuleInput: boolean | null;

  @Column({ field: 'is_sensitive', type: DataType.BOOLEAN })
  declare isSensitive: boolean | null;

  @Column({ field: 'allowed_for_credit_decision', type: DataType.BOOLEAN })
  declare allowedForCreditDecision: boolean | null;

  @Column({ field: 'allowed_for_fraud_decision', type: DataType.BOOLEAN })
  declare allowedForFraudDecision: boolean | null;

  @Column({ field: 'legal_review_status', type: DataType.STRING(40) })
  declare legalReviewStatus: string | null;

  @Column({ field: 'prohibited_reason_code', type: DataType.STRING(100) })
  declare prohibitedReasonCode: string | null;

  @Column({ field: 'fairness_review_required', type: DataType.BOOLEAN })
  declare fairnessReviewRequired: boolean | null;

  @Column({ field: 'retention_policy_id', type: DataType.BIGINT })
  declare retentionPolicyId: string | null;

  @Column({ field: 'owner_team', type: DataType.STRING(80) })
  declare ownerTeam: string | null;

  @Column({ field: 'domain_code', type: DataType.STRING(120) })
  declare domainCode: string | null;

  @Column({ field: 'review_status', type: DataType.STRING(40), allowNull: false })
  declare reviewStatus: string;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
