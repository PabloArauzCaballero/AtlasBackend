import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'risk_ruleset_versions', timestamps: false })
export class RiskRulesetVersionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'ruleset_code', type: DataType.STRING(80) })
  declare rulesetCode: string | null;

  @Column({ field: 'version_code', type: DataType.STRING(80) })
  declare versionCode: string | null;

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

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
