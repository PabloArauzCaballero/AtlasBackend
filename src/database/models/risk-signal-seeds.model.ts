import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'risk_signal_seeds', timestamps: false })
export class RiskSignalSeedModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'signal_code', type: DataType.STRING(120) })
  declare signalCode: string | null;

  @Column({ field: 'signal_name', type: DataType.STRING(180) })
  declare signalName: string | null;

  @Column({ field: 'signal_type', type: DataType.STRING(60) })
  declare signalType: string | null;

  @Column({ field: 'source_entity', type: DataType.STRING(120) })
  declare sourceEntity: string | null;

  @Column({ field: 'target_definition_code', type: DataType.STRING(120) })
  declare targetDefinitionCode: string | null;

  @Column({ field: 'risk_dimension', type: DataType.STRING(60) })
  declare riskDimension: string | null;

  @Column({ field: 'build_phase', type: DataType.STRING(40) })
  declare buildPhase: string | null;

  @Column({ field: 'priority', type: DataType.STRING(40) })
  declare priority: string | null;

  @Column({ field: 'expected_direction', type: DataType.STRING(40) })
  declare expectedDirection: string | null;

  @Column({ field: 'example_value_json', type: DataType.JSONB })
  declare exampleValueJson: Record<string, unknown> | null;

  @Column({ field: 'rationale', type: DataType.TEXT })
  declare rationale: string | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
