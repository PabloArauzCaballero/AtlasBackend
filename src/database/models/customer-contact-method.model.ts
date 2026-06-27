import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_contact_methods', timestamps: false })
export class CustomerContactMethodModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'contact_type', type: DataType.STRING(40) })
  declare contactType: string | null;

  @Column({ field: 'contact_value_hash', type: DataType.STRING(128) })
  declare contactValueHash: string | null;

  @Column({ field: 'contact_value_encrypted', type: DataType.TEXT })
  declare contactValueEncrypted: string | null;

  @Column({ field: 'normalized_value_hash', type: DataType.STRING(128) })
  declare normalizedValueHash: string | null;

  @Column({ field: 'value_last_4', type: DataType.STRING(4) })
  declare valueLast4: string | null;

  @Column({ field: 'email_domain', type: DataType.STRING(120) })
  declare emailDomain: string | null;

  @Column({ field: 'label', type: DataType.STRING(80) })
  declare label: string | null;

  @Column({ field: 'is_primary', type: DataType.BOOLEAN })
  declare isPrimary: boolean | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: 'source_type', type: DataType.STRING(40) })
  declare sourceType: string | null;

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
