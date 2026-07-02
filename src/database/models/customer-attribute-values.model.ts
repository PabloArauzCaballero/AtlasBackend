import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_attribute_values', timestamps: false })
export class CustomerAttributeValueModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'attribute_definition_id', type: DataType.BIGINT })
  declare attributeDefinitionId: string | null;

  @Column({ field: 'value_text', type: DataType.TEXT })
  declare valueText: string | null;

  @Column({ field: 'value_number', type: DataType.DECIMAL(18, 4) })
  declare valueNumber: string | null;

  @Column({ field: 'value_boolean', type: DataType.BOOLEAN })
  declare valueBoolean: boolean | null;

  @Column({ field: 'value_json', type: DataType.JSONB })
  declare valueJson: Record<string, unknown> | null;

  @Column({ field: 'source_type', type: DataType.STRING(60) })
  declare sourceType: string | null;

  @Column({ field: 'evidence_id', type: DataType.BIGINT })
  declare evidenceId: string | null;

  @Column({ field: 'confidence_score', type: DataType.DECIMAL(5, 2) })
  declare confidenceScore: string | null;

  @Column({ field: 'verification_status', type: DataType.STRING(40) })
  declare verificationStatus: string | null;

  @Column({ field: 'valid_from', type: DataType.DATE })
  declare validFrom: Date | null;

  @Column({ field: 'valid_until', type: DataType.DATE })
  declare validUntil: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
