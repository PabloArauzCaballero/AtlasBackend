import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_data_entity_catalog', timestamps: false })
export class SystemDataEntityCatalogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'schema_name', type: DataType.STRING(120), allowNull: false })
  declare schemaName: string;

  @Column({ field: 'table_name', type: DataType.STRING(180), allowNull: false })
  declare tableName: string;

  @Column({ field: 'model_name', type: DataType.STRING(180) })
  declare modelName: string | null;

  @Column({ field: 'entity_name', type: DataType.STRING(220), allowNull: false })
  declare entityName: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare module: string;

  @Column({ field: 'business_purpose', type: DataType.TEXT, allowNull: false })
  declare businessPurpose: string;

  @Column({ field: 'data_owner', type: DataType.STRING(120), allowNull: false })
  declare dataOwner: string;

  @Column({ field: 'contains_pii', type: DataType.BOOLEAN, allowNull: false })
  declare containsPii: boolean;

  @Column({ field: 'contains_financial_data', type: DataType.BOOLEAN, allowNull: false })
  declare containsFinancialData: boolean;

  @Column({ field: 'contains_risk_data', type: DataType.BOOLEAN, allowNull: false })
  declare containsRiskData: boolean;

  @Column({ field: 'contains_legal_data', type: DataType.BOOLEAN, allowNull: false })
  declare containsLegalData: boolean;

  @Column({ field: 'contains_device_data', type: DataType.BOOLEAN, allowNull: false })
  declare containsDeviceData: boolean;

  @Column({ field: 'contains_location_data', type: DataType.BOOLEAN, allowNull: false })
  declare containsLocationData: boolean;

  @Column({ field: 'is_audit_critical', type: DataType.BOOLEAN, allowNull: false })
  declare isAuditCritical: boolean;

  @Column({ field: 'retention_policy_code', type: DataType.STRING(120) })
  declare retentionPolicyCode: string | null;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare status: string;

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
