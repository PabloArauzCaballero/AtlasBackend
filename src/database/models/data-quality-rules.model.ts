import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'data_quality_rules', timestamps: false })
export class DataQualityRuleModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'rule_code', type: DataType.STRING(120) })
  declare ruleCode: string | null;

  @Column({ field: 'rule_name', type: DataType.STRING(180) })
  declare ruleName: string | null;

  @Column({ field: 'target_table', type: DataType.STRING(120) })
  declare targetTable: string | null;

  @Column({ field: 'target_field', type: DataType.STRING(120) })
  declare targetField: string | null;

  @Column({ field: 'severity', type: DataType.STRING(40) })
  declare severity: string | null;

  @Column({ field: 'expression_json', type: DataType.JSONB })
  declare expressionJson: Record<string, unknown> | null;

  @Column({ field: 'expected_action', type: DataType.STRING(80) })
  declare expectedAction: string | null;

  @Column({ field: 'build_phase', type: DataType.STRING(40) })
  declare buildPhase: string | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
