import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'data_providers', timestamps: false })
export class DataProviderModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'provider_code', type: DataType.STRING(80) })
  declare providerCode: string | null;

  @Column({ field: 'provider_name', type: DataType.STRING(180) })
  declare providerName: string | null;

  @Column({ field: 'provider_type', type: DataType.STRING(60) })
  declare providerType: string | null;

  @Column({ field: 'reliability_score', type: DataType.DECIMAL(5, 2) })
  declare reliabilityScore: string | null;

  @Column({ field: 'supports_retro_data', type: DataType.BOOLEAN })
  declare supportsRetroData: boolean | null;

  @Column({ field: 'default_retention_policy_id', type: DataType.BIGINT })
  declare defaultRetentionPolicyId: string | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
