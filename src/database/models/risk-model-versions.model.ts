import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'risk_model_versions', timestamps: false })
export class RiskModelVersionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'model_code', type: DataType.STRING(80) })
  declare modelCode: string | null;

  @Column({ field: 'version_code', type: DataType.STRING(80) })
  declare versionCode: string | null;

  @Column({ field: 'model_type', type: DataType.STRING(60) })
  declare modelType: string | null;

  @Column({ field: 'assessment_type', type: DataType.STRING(80) })
  declare assessmentType: string | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: 'effective_from', type: DataType.DATE })
  declare effectiveFrom: Date | null;

  @Column({ field: 'effective_until', type: DataType.DATE })
  declare effectiveUntil: Date | null;

  @Column({ field: 'approved_by_platform_user_id', type: DataType.BIGINT })
  declare approvedByPlatformUserId: string | null;

  @Column({ field: 'approved_at', type: DataType.DATE })
  declare approvedAt: Date | null;

  @Column({ field: 'artifact_url', type: DataType.TEXT })
  declare artifactUrl: string | null;

  @Column({ field: 'artifact_hash', type: DataType.STRING(128) })
  declare artifactHash: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
