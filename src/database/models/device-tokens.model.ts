import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'device_tokens', timestamps: false })
export class DeviceTokenModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'platform', type: DataType.STRING(40), allowNull: false })
  declare platform: string;

  @Column({ field: 'token_hash', type: DataType.STRING(128), allowNull: false })
  declare tokenHash: string;

  @Column({ field: 'token_encrypted', type: DataType.TEXT })
  declare tokenEncrypted: string | null;

  @Column({ field: 'token_last4', type: DataType.STRING(12) })
  declare tokenLast4: string | null;

  @Column({ field: 'device_id', type: DataType.STRING(180) })
  declare deviceId: string | null;

  @Column({ field: 'is_active', type: DataType.BOOLEAN, allowNull: false })
  declare isActive: boolean;

  @Column({ field: 'last_seen_at', type: DataType.DATE })
  declare lastSeenAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
