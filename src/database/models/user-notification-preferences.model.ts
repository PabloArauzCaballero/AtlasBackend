import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'user_notification_preferences', timestamps: false })
export class UserNotificationPreferenceModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'event_code', type: DataType.STRING(160), allowNull: false })
  declare eventCode: string;

  @Column({ field: 'channel', type: DataType.STRING(40), allowNull: false })
  declare channel: string;

  @Column({ field: 'is_enabled', type: DataType.BOOLEAN, allowNull: false })
  declare isEnabled: boolean;

  @Column({ field: 'is_required', type: DataType.BOOLEAN, allowNull: false })
  declare isRequired: boolean;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
