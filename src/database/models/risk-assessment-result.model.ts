import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'risk_assessment_results', timestamps: false })
export class RiskAssessmentResultModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'risk_assessment_run_id', type: DataType.BIGINT, allowNull: false })
  declare riskAssessmentRunId: string;

  @Column({ field: 'subject_type', type: DataType.STRING(40) })
  declare subjectType: string | null;

  @Column({ field: 'subject_id', type: DataType.BIGINT })
  declare subjectId: string | null;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'onboarding_flow_id', type: DataType.BIGINT })
  declare onboardingFlowId: string | null;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'assessment_type', type: DataType.STRING(60) })
  declare assessmentType: string | null;

  @Column({ field: 'recommended_action', type: DataType.STRING(60) })
  declare recommendedAction: string | null;

  @Column({ field: 'risk_level', type: DataType.STRING(40) })
  declare riskLevel: string | null;

  @Column({ field: 'score_total', type: DataType.INTEGER })
  declare scoreTotal: number | null;

  @Column({ field: 'fraud_score', type: DataType.INTEGER })
  declare fraudScore: number | null;

  @Column({ field: 'identity_score', type: DataType.INTEGER })
  declare identityScore: number | null;

  @Column({ field: 'device_risk_score', type: DataType.INTEGER })
  declare deviceRiskScore: number | null;

  @Column({ field: 'behavior_score', type: DataType.INTEGER })
  declare behaviorScore: number | null;

  @Column({ field: 'contactability_score', type: DataType.INTEGER })
  declare contactabilityScore: number | null;

  @Column({ field: 'consistency_score', type: DataType.INTEGER })
  declare consistencyScore: number | null;

  @Column({ field: 'reason_codes_json', type: DataType.JSONB })
  declare reasonCodesJson: unknown | null;

  @Column({ field: 'model_version_code_snapshot', type: DataType.STRING(80) })
  declare modelVersionCodeSnapshot: string | null;

  @Column({ field: 'ruleset_version_code_snapshot', type: DataType.STRING(80) })
  declare rulesetVersionCodeSnapshot: string | null;

  @Column({ field: 'feature_snapshot_id', type: DataType.BIGINT })
  declare featureSnapshotId: string | null;

  @Column({ field: 'integrity_hash', type: DataType.STRING(128) })
  declare integrityHash: string | null;

  @Column({ field: 'decided_at', type: DataType.DATE })
  declare decidedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
