import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'context_risk_mappings', timestamps: false })
export class ContextRiskMappingModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'context_item_id', type: DataType.BIGINT })
  declare contextItemId: string | null;

  @Column({ field: 'risk_dimension', type: DataType.STRING(60) })
  declare riskDimension: string | null;

  @Column({ field: 'risk_band', type: DataType.STRING(40) })
  declare riskBand: string | null;

  @Column({ field: 'score_points_suggested', type: DataType.DECIMAL(8, 2) })
  declare scorePointsSuggested: string | null;

  @Column({ field: 'reason_code', type: DataType.STRING(100) })
  declare reasonCode: string | null;

  @Column({ field: 'explanation', type: DataType.TEXT })
  declare explanation: string | null;

  @Column({ field: 'model_usage', type: DataType.STRING(80) })
  declare modelUsage: string | null;

  @Column({ field: 'valid_from', type: DataType.DATEONLY })
  declare validFrom: string | null;

  @Column({ field: 'valid_until', type: DataType.DATEONLY })
  declare validUntil: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
