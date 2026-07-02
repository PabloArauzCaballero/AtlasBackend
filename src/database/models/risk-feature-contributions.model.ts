import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'risk_feature_contributions', timestamps: false })
export class RiskFeatureContributionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'risk_assessment_run_id', type: DataType.BIGINT })
  declare riskAssessmentRunId: string | null;

  @Column({ field: 'feature_code', type: DataType.STRING(120) })
  declare featureCode: string | null;

  @Column({ field: 'raw_value_json', type: DataType.JSONB })
  declare rawValueJson: Record<string, unknown> | null;

  @Column({ field: 'bin_or_attribute', type: DataType.STRING(120) })
  declare binOrAttribute: string | null;

  @Column({ field: 'woe_value', type: DataType.DECIMAL(12, 6) })
  declare woeValue: string | null;

  @Column({ field: 'score_points', type: DataType.DECIMAL(8, 2) })
  declare scorePoints: string | null;

  @Column({ field: 'reason_code', type: DataType.STRING(100) })
  declare reasonCode: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
