import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_operational_rule_catalog', timestamps: false })
export class SystemOperationalRuleCatalogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'rule_code', type: DataType.STRING(180), allowNull: false, unique: true })
  declare ruleCode: string;

  @Column({ field: 'scope_type', type: DataType.STRING(40), allowNull: false })
  declare scopeType: string;

  @Column({ field: 'schema_name', type: DataType.STRING(120), allowNull: false })
  declare schemaName: string;

  @Column({ field: 'table_name', type: DataType.STRING(180) })
  declare tableName: string | null;

  @Column({ field: 'domain_code', type: DataType.STRING(120) })
  declare domainCode: string | null;

  @Column({ field: 'rule_type', type: DataType.STRING(40), allowNull: false })
  declare ruleType: string;

  @Column({ field: 'rule_name', type: DataType.STRING(220), allowNull: false })
  declare ruleName: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare description: string;

  @Column({ field: 'business_reason', type: DataType.TEXT })
  declare businessReason: string | null;

  @Column({ field: 'technical_enforcement', type: DataType.TEXT })
  declare technicalEnforcement: string | null;

  @Column({ field: 'enforcement_layer', type: DataType.STRING(120) })
  declare enforcementLayer: string | null;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare severity: string;

  @Column({ field: 'expected_action', type: DataType.TEXT })
  declare expectedAction: string | null;

  @Column({ field: 'audit_evidence', type: DataType.TEXT })
  declare auditEvidence: string | null;

  @Column({ field: 'analysis_value', type: DataType.TEXT })
  declare analysisValue: string | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN, allowNull: false })
  declare isActive: boolean;

  @Column({ field: 'source_document', type: DataType.STRING(120), allowNull: false })
  declare sourceDocument: string;

  @Column({ field: 'confidence_level', type: DataType.STRING(20), allowNull: false })
  declare confidenceLevel: string;

  @Column({ field: 'review_status', type: DataType.STRING(40), allowNull: false })
  declare reviewStatus: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
