import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'risk_policy_rules', timestamps: false })
export class RiskPolicyRuleModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'ruleset_version_id', type: DataType.BIGINT })
  declare rulesetVersionId: string | null;

  @Column({ field: 'rule_code', type: DataType.STRING(120) })
  declare ruleCode: string | null;

  @Column({ field: 'rule_name', type: DataType.STRING(180) })
  declare ruleName: string | null;

  @Column({ field: 'risk_dimension', type: DataType.STRING(60) })
  declare riskDimension: string | null;

  @Column({ field: 'rule_type', type: DataType.STRING(60) })
  declare ruleType: string | null;

  @Column({ field: 'severity', type: DataType.STRING(40) })
  declare severity: string | null;

  @Column({ field: 'expression_json', type: DataType.JSONB })
  declare expressionJson: Record<string, unknown> | null;

  @Column({ field: 'action_code', type: DataType.STRING(80) })
  declare actionCode: string | null;

  @Column({ field: 'reason_code', type: DataType.STRING(100) })
  declare reasonCode: string | null;

  @Column({ field: 'is_hard_stop', type: DataType.BOOLEAN })
  declare isHardStop: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
