import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'data_classification_policies', timestamps: false })
export class DataClassificationPolicyModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'classification_code', type: DataType.STRING(80) })
  declare classificationCode: string | null;

  @Column({ field: 'classification_name', type: DataType.STRING(160) })
  declare classificationName: string | null;

  @Column({ field: 'sensitivity_level', type: DataType.STRING(40) })
  declare sensitivityLevel: string | null;

  @Column({ field: 'allowed_storage_modes_json', type: DataType.JSONB })
  declare allowedStorageModesJson: Record<string, unknown> | null;

  @Column({ field: 'default_storage_mode', type: DataType.STRING(40) })
  declare defaultStorageMode: string | null;

  @Column({ field: 'default_retention_policy_id', type: DataType.BIGINT })
  declare defaultRetentionPolicyId: string | null;

  @Column({ field: 'encryption_required', type: DataType.BOOLEAN })
  declare encryptionRequired: boolean | null;

  @Column({ field: 'hashing_required', type: DataType.BOOLEAN })
  declare hashingRequired: boolean | null;

  @Column({ field: 'raw_storage_allowed', type: DataType.BOOLEAN })
  declare rawStorageAllowed: boolean | null;

  @Column({ field: 'description', type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
