import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'feature_snapshots', timestamps: false })
export class FeatureSnapshotModel extends Model {
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

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'snapshot_reason', type: DataType.STRING(80) })
  declare snapshotReason: string | null;

  @Column({ field: 'triggering_entity_type', type: DataType.STRING(80) })
  declare triggeringEntityType: string | null;

  @Column({ field: 'triggering_entity_id', type: DataType.BIGINT })
  declare triggeringEntityId: string | null;

  @Column({ field: 'risk_assessment_run_id', type: DataType.BIGINT })
  declare riskAssessmentRunId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'onboarding_flow_id', type: DataType.BIGINT })
  declare onboardingFlowId: string | null;

  @Column({ field: 'feature_set_version', type: DataType.STRING(80) })
  declare featureSetVersion: string | null;

  @Column({ field: 'catalog_versions_json', type: DataType.JSONB })
  declare catalogVersionsJson: Record<string, unknown> | null;

  @Column({ field: 'features_json', type: DataType.JSONB })
  declare featuresJson: Record<string, unknown> | null;

  @Column({ field: 'missing_features_json', type: DataType.JSONB })
  declare missingFeaturesJson: Record<string, unknown> | null;

  @Column({ field: 'integrity_hash', type: DataType.STRING(128) })
  declare integrityHash: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
