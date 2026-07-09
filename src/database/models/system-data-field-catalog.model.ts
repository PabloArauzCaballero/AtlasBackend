import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';
import { SystemDataEntityCatalogModel } from './system-data-entity-catalog.model.js';

@Table({ tableName: 'system_data_field_catalog', timestamps: false })
export class SystemDataFieldCatalogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @ForeignKey(() => SystemDataEntityCatalogModel)
  @Column({ field: 'data_entity_id', type: DataType.BIGINT })
  declare dataEntityId: string | null;

  @Column({ field: 'schema_name', type: DataType.STRING(120), allowNull: false })
  declare schemaName: string;

  @Column({ field: 'table_name', type: DataType.STRING(180), allowNull: false })
  declare tableName: string;

  @Column({ field: 'column_name', type: DataType.STRING(180), allowNull: false })
  declare columnName: string;

  @Column({ field: 'ordinal_position', type: DataType.INTEGER })
  declare ordinalPosition: number | null;

  @Column({ field: 'sql_data_type', type: DataType.STRING(120) })
  declare sqlDataType: string | null;

  @Column({ field: 'is_nullable', type: DataType.BOOLEAN, allowNull: false })
  declare isNullable: boolean;

  @Column({ field: 'column_default', type: DataType.TEXT })
  declare columnDefault: string | null;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: 'detected_from', type: DataType.STRING(80), allowNull: false })
  declare detectedFrom: string;

  @Column({ field: 'is_primary_key', type: DataType.BOOLEAN, allowNull: false })
  declare isPrimaryKey: boolean;

  @Column({ field: 'is_foreign_key', type: DataType.BOOLEAN, allowNull: false })
  declare isForeignKey: boolean;

  @Column({ field: 'referenced_schema', type: DataType.STRING(120) })
  declare referencedSchema: string | null;

  @Column({ field: 'referenced_table', type: DataType.STRING(180) })
  declare referencedTable: string | null;

  @Column({ field: 'referenced_column', type: DataType.STRING(180) })
  declare referencedColumn: string | null;

  @ForeignKey(() => SystemDataEntityCatalogModel)
  @Column({ field: 'references_entity_id', type: DataType.BIGINT })
  declare referencesEntityId: string | null;

  @Column({ field: 'business_name', type: DataType.STRING(220) })
  declare businessName: string | null;

  @Column({ field: 'business_meaning', type: DataType.TEXT })
  declare businessMeaning: string | null;

  @Column({ field: 'technical_meaning', type: DataType.TEXT })
  declare technicalMeaning: string | null;

  @Column({ field: 'system_purpose', type: DataType.TEXT })
  declare systemPurpose: string | null;

  @Column({ field: 'business_purpose', type: DataType.TEXT })
  declare businessPurpose: string | null;

  @Column({ field: 'why_store', type: DataType.TEXT })
  declare whyStore: string | null;

  @Column({ field: 'who_uses', type: DataType.JSONB, allowNull: false })
  declare whoUses: string[];

  @Column({ field: 'audit_usage', type: DataType.TEXT })
  declare auditUsage: string | null;

  @Column({ field: 'analysis_usage', type: DataType.TEXT })
  declare analysisUsage: string | null;

  @Column({ field: 'decision_usage', type: DataType.TEXT })
  declare decisionUsage: string | null;

  @Column({ field: 'source_kind', type: DataType.STRING(80) })
  declare sourceKind: string | null;

  @Column({ field: 'payload_paths_json', type: DataType.JSONB, allowNull: false })
  declare payloadPathsJson: string[];

  @Column({ field: 'backend_write_behavior', type: DataType.TEXT })
  declare backendWriteBehavior: string | null;

  @Column({ field: 'data_nature', type: DataType.STRING(60) })
  declare dataNature: string | null;

  @Column({ field: 'domain_code', type: DataType.STRING(120) })
  declare domainCode: string | null;

  @Column({ field: 'governance_category', type: DataType.STRING(80) })
  declare governanceCategory: string | null;

  @Column({ field: 'classification_code', type: DataType.STRING(120) })
  declare classificationCode: string | null;

  @Column({ field: 'sensitivity_level', type: DataType.STRING(40) })
  declare sensitivityLevel: string | null;

  @Column({ field: 'contains_pii', type: DataType.BOOLEAN, allowNull: false })
  declare containsPii: boolean;

  @Column({ field: 'pii_type', type: DataType.STRING(120) })
  declare piiType: string | null;

  @Column({ field: 'contains_sensitive', type: DataType.BOOLEAN, allowNull: false })
  declare containsSensitive: boolean;

  @Column({ field: 'contains_financial_data', type: DataType.BOOLEAN, allowNull: false })
  declare containsFinancialData: boolean;

  @Column({ field: 'contains_risk_data', type: DataType.BOOLEAN, allowNull: false })
  declare containsRiskData: boolean;

  @Column({ field: 'contains_fraud_signal', type: DataType.BOOLEAN, allowNull: false })
  declare containsFraudSignal: boolean;

  @Column({ field: 'contains_capacity_signal', type: DataType.BOOLEAN, allowNull: false })
  declare containsCapacitySignal: boolean;

  @Column({ field: 'is_ml_candidate', type: DataType.BOOLEAN, allowNull: false })
  declare isMlCandidate: boolean;

  @Column({ field: 'used_in_scoring', type: DataType.BOOLEAN, allowNull: false })
  declare usedInScoring: boolean;

  @Column({ field: 'used_in_ml', type: DataType.BOOLEAN, allowNull: false })
  declare usedInMl: boolean;

  @Column({ field: 'ml_feature_group', type: DataType.STRING(120) })
  declare mlFeatureGroup: string | null;

  @Column({ field: 'quality_rules_json', type: DataType.JSONB, allowNull: false })
  declare qualityRulesJson: unknown[];

  @Column({ field: 'validation_rule_json', type: DataType.JSONB, allowNull: false })
  declare validationRuleJson: Record<string, unknown>;

  @Column({ field: 'allowed_values', type: DataType.JSONB })
  declare allowedValues: unknown[] | null;

  @Column({ field: 'retention_policy_code', type: DataType.STRING(120) })
  declare retentionPolicyCode: string | null;

  @Column({ field: 'frontend_label', type: DataType.STRING(220) })
  declare frontendLabel: string | null;

  @Column({ field: 'form_usage', type: DataType.TEXT })
  declare formUsage: string | null;

  @Column({ field: 'relationship_notes', type: DataType.TEXT })
  declare relationshipNotes: string | null;

  @Column({ field: 'operational_notes', type: DataType.TEXT })
  declare operationalNotes: string | null;

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

  @Column({ field: 'manually_edited_at', type: DataType.DATE })
  declare manuallyEditedAt: Date | null;
}
