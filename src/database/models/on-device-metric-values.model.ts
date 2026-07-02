import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'on_device_metric_values', timestamps: false })
export class OnDeviceMetricValueModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'computation_run_id', type: DataType.BIGINT })
  declare computationRunId: string | null;

  @Column({ field: 'metric_code', type: DataType.STRING(120) })
  declare metricCode: string | null;

  @Column({ field: 'value_text', type: DataType.TEXT })
  declare valueText: string | null;

  @Column({ field: 'value_number', type: DataType.DECIMAL(18, 4) })
  declare valueNumber: string | null;

  @Column({ field: 'value_boolean', type: DataType.BOOLEAN })
  declare valueBoolean: boolean | null;

  @Column({ field: 'value_json', type: DataType.JSONB })
  declare valueJson: Record<string, unknown> | null;

  @Column({ field: 'confidence_score', type: DataType.DECIMAL(5, 2) })
  declare confidenceScore: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
