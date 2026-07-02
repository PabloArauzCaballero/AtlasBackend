import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_addresses', timestamps: false })
export class CustomerAddressModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'address_type', type: DataType.STRING(40) })
  declare addressType: string | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: 'current_version_id', type: DataType.BIGINT })
  declare currentVersionId: string | null;

  @Column({ field: 'first_seen_at', type: DataType.DATE })
  declare firstSeenAt: Date | null;

  @Column({ field: 'last_seen_at', type: DataType.DATE })
  declare lastSeenAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
