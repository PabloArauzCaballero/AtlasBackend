import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_status_events', timestamps: false })
export class CustomerStatusEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'previous_status', type: DataType.STRING(40) })
  declare previousStatus: string | null;

  @Column({ field: 'new_status', type: DataType.STRING(40) })
  declare newStatus: string | null;

  @Column({ field: 'reason_code', type: DataType.STRING(80) })
  declare reasonCode: string | null;

  @Column({ field: 'changed_by_type', type: DataType.STRING(40) })
  declare changedByType: string | null;

  @Column({ field: 'changed_by_internal_user_id', type: DataType.BIGINT })
  declare changedByInternalUserId: string | null;

  @Column({ field: 'changed_by_platform_user_id', type: DataType.BIGINT })
  declare changedByPlatformUserId: string | null;

  @Column({ field: 'happened_at', type: DataType.DATE })
  declare happenedAt: Date | null;

  @Column({ field: 'notes', type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
