import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'risk_rules_fired', timestamps: false })
export class RiskRuleFiredModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'risk_assessment_run_id', type: DataType.BIGINT })
  declare riskAssessmentRunId: string | null;

  @Column({ field: 'risk_policy_rule_id', type: DataType.BIGINT })
  declare riskPolicyRuleId: string | null;

  @Column({ field: 'rule_code_snapshot', type: DataType.STRING(120) })
  declare ruleCodeSnapshot: string | null;

  @Column({ field: 'ruleset_version_code_snapshot', type: DataType.STRING(80) })
  declare rulesetVersionCodeSnapshot: string | null;

  @Column({ field: 'risk_dimension', type: DataType.STRING(60) })
  declare riskDimension: string | null;

  @Column({ field: 'input_values_json', type: DataType.JSONB })
  declare inputValuesJson: Record<string, unknown> | null;

  @Column({ field: 'output_action', type: DataType.STRING(80) })
  declare outputAction: string | null;

  @Column({ field: 'reason_code', type: DataType.STRING(100) })
  declare reasonCode: string | null;

  @Column({ field: 'severity', type: DataType.STRING(40) })
  declare severity: string | null;

  @Column({ field: 'is_hard_stop', type: DataType.BOOLEAN })
  declare isHardStop: boolean | null;

  @Column({ field: 'fired_at', type: DataType.DATE })
  declare firedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
