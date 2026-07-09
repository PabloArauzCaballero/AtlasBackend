import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_endpoint_tool_requirements', timestamps: false })
export class SystemEndpointToolRequirementModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'endpoint_id', type: DataType.BIGINT, allowNull: false })
  declare endpointId: string;

  @Column({ field: 'tool_id', type: DataType.BIGINT, allowNull: false })
  declare toolId: string;

  @Column({ field: 'usage_type', type: DataType.STRING(60), allowNull: false })
  declare usageType: string;

  @Column({ field: 'is_required', type: DataType.BOOLEAN, allowNull: false })
  declare isRequired: boolean;

  @Column({ field: 'failure_impact', type: DataType.STRING(20), allowNull: false })
  declare failureImpact: string;

  @Column({ field: 'fallback_strategy', type: DataType.TEXT })
  declare fallbackStrategy: string | null;

  @Column({ field: 'requires_mock', type: DataType.BOOLEAN, allowNull: false })
  declare requiresMock: boolean;

  @Column({ field: 'requires_stress_test', type: DataType.BOOLEAN, allowNull: false })
  declare requiresStressTest: boolean;

  @Column({ type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: 'detected_from', type: DataType.STRING(80), allowNull: false })
  declare detectedFrom: string;

  @Column({ field: 'confidence_level', type: DataType.STRING(20), allowNull: false })
  declare confidenceLevel: string;

  @Column({ field: 'review_status', type: DataType.STRING(40), allowNull: false })
  declare reviewStatus: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
