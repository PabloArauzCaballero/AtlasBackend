import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'sensitive_field_rules', timestamps: false })
export class SensitiveFieldRuleModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'table_name', type: DataType.STRING(120) })
  declare tableName: string | null;

  @Column({ field: 'field_name', type: DataType.STRING(120) })
  declare fieldName: string | null;

  @Column({ field: 'classification_code', type: DataType.STRING(80) })
  declare classificationCode: string | null;

  @Column({ field: 'storage_mode', type: DataType.STRING(40) })
  declare storageMode: string | null;

  @Column({ field: 'search_strategy', type: DataType.STRING(40) })
  declare searchStrategy: string | null;

  @Column({ field: 'masking_strategy', type: DataType.STRING(40) })
  declare maskingStrategy: string | null;

  @Column({ field: 'access_policy_code', type: DataType.STRING(80) })
  declare accessPolicyCode: string | null;

  @Column({ field: 'retention_policy_id', type: DataType.BIGINT })
  declare retentionPolicyId: string | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
