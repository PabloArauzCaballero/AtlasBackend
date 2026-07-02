import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'data_change_logs', timestamps: false })
export class DataChangeLogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'table_name', type: DataType.STRING(120) })
  declare tableName: string | null;

  @Column({ field: 'record_id', type: DataType.STRING(120) })
  declare recordId: string | null;

  @Column({ field: 'change_type', type: DataType.STRING(40) })
  declare changeType: string | null;

  @Column({ field: 'changed_by_type', type: DataType.STRING(40) })
  declare changedByType: string | null;

  @Column({ field: 'changed_by_internal_user_id', type: DataType.BIGINT })
  declare changedByInternalUserId: string | null;

  @Column({ field: 'changed_by_platform_user_id', type: DataType.BIGINT })
  declare changedByPlatformUserId: string | null;

  @Column({ field: 'old_values_hash', type: DataType.STRING(128) })
  declare oldValuesHash: string | null;

  @Column({ field: 'new_values_hash', type: DataType.STRING(128) })
  declare newValuesHash: string | null;

  @Column({ field: 'change_reason', type: DataType.TEXT })
  declare changeReason: string | null;

  @Column({ field: 'changed_at', type: DataType.DATE })
  declare changedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
