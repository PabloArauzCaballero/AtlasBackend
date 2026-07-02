import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'feature_computation_runs', timestamps: false })
export class FeatureComputationRunModel extends Model {
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

  @Column({ field: 'run_reason', type: DataType.STRING(80) })
  declare runReason: string | null;

  @Column({ field: 'trigger_source', type: DataType.STRING(80) })
  declare triggerSource: string | null;

  @Column({ field: 'idempotency_key', type: DataType.STRING(128) })
  declare idempotencyKey: string | null;

  @Column({ field: 'feature_set_version', type: DataType.STRING(80) })
  declare featureSetVersion: string | null;

  @Column({ field: 'code_version', type: DataType.STRING(80) })
  declare codeVersion: string | null;

  @Column({ field: 'computed_by', type: DataType.STRING(80) })
  declare computedBy: string | null;

  @Column({ field: 'retry_count', type: DataType.INTEGER })
  declare retryCount: number | null;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @Column({ field: 'finished_at', type: DataType.DATE })
  declare finishedAt: Date | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: 'error_message', type: DataType.TEXT })
  declare errorMessage: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
