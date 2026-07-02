import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'risk_assessment_runs', timestamps: false })
export class RiskAssessmentRunModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

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

  @Column({ field: 'feature_snapshot_id', type: DataType.BIGINT })
  declare featureSnapshotId: string | null;

  @Column({ field: 'risk_model_version_id', type: DataType.BIGINT })
  declare riskModelVersionId: string | null;

  @Column({ field: 'risk_ruleset_version_id', type: DataType.BIGINT })
  declare riskRulesetVersionId: string | null;

  @Column({ field: 'assessment_type', type: DataType.STRING(80) })
  declare assessmentType: string | null;

  @Column({ field: 'trigger_source', type: DataType.STRING(80) })
  declare triggerSource: string | null;

  @Column({ field: 'idempotency_key', type: DataType.STRING(128) })
  declare idempotencyKey: string | null;

  @Column({ field: 'run_status', type: DataType.STRING(40) })
  declare runStatus: string | null;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @Column({ field: 'completed_at', type: DataType.DATE })
  declare completedAt: Date | null;

  @Column({ field: 'latency_ms', type: DataType.INTEGER })
  declare latencyMs: number | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
