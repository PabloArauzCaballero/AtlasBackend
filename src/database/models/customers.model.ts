import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customers', timestamps: false })
export class CustomerModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_code', type: DataType.STRING(40) })
  declare customerCode: string | null;

  @Column({ field: 'customer_uuid', type: DataType.UUID })
  declare customerUuid: string | null;

  @Column({ field: 'primary_phone_hash', type: DataType.STRING(128) })
  declare primaryPhoneHash: string | null;

  @Column({ field: 'primary_phone_encrypted', type: DataType.BLOB })
  declare primaryPhoneEncrypted: string | null;

  @Column({ field: 'primary_phone_last_4', type: DataType.STRING(4) })
  declare primaryPhoneLast4: string | null;

  @Column({ field: 'primary_email_hash', type: DataType.STRING(128) })
  declare primaryEmailHash: string | null;

  @Column({ field: 'primary_email_encrypted', type: DataType.BLOB })
  declare primaryEmailEncrypted: string | null;

  @Column({ field: 'primary_email_domain', type: DataType.STRING(120) })
  declare primaryEmailDomain: string | null;

  @Column({ field: 'lifecycle_status', type: DataType.STRING(40) })
  declare lifecycleStatus: string | null;

  @Column({ field: 'current_profile_version_id', type: DataType.BIGINT })
  declare currentProfileVersionId: string | null;

  @Column({ field: 'closed_at', type: DataType.DATE })
  declare closedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
