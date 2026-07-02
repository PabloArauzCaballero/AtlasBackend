import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'customer_reference_contacts', timestamps: false })
export class CustomerReferenceContactModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'relationship_type', type: DataType.STRING(60) })
  declare relationshipType: string | null;

  @Column({ field: 'full_name_hash', type: DataType.STRING(128) })
  declare fullNameHash: string | null;

  @Column({ field: 'full_name_encrypted', type: DataType.BLOB })
  declare fullNameEncrypted: string | null;

  @Column({ field: 'phone_hash', type: DataType.STRING(128) })
  declare phoneHash: string | null;

  @Column({ field: 'phone_encrypted', type: DataType.BLOB })
  declare phoneEncrypted: string | null;

  @Column({ field: 'phone_last_4', type: DataType.STRING(4) })
  declare phoneLast4: string | null;

  @Column({ field: 'consent_basis', type: DataType.STRING(80) })
  declare consentBasis: string | null;

  @Column({ field: 'reference_notified', type: DataType.BOOLEAN })
  declare referenceNotified: boolean | null;

  @Column({ field: 'reference_notified_at', type: DataType.DATE })
  declare referenceNotifiedAt: Date | null;

  @Column({ field: 'contactability_status', type: DataType.STRING(40) })
  declare contactabilityStatus: string | null;

  @Column({ field: 'verification_status', type: DataType.STRING(40) })
  declare verificationStatus: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
