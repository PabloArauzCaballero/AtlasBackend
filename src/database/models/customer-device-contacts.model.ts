/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({
  tableName: 'customer_device_contacts',
  schema: atlasSchemaFor('customer_device_contacts'),
  timestamps: false,
})
export class CustomerDeviceContactModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'computation_run_id', type: DataType.BIGINT })
  declare computationRunId: string | null;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'consent_id', type: DataType.BIGINT })
  declare consentId: string | null;

  @Column({ field: 'source', type: DataType.STRING(40) })
  declare source: string;

  @Column({ field: 'contact_external_id_hash', type: DataType.STRING(128), allowNull: false })
  declare contactExternalIdHash: string;

  @Column({ field: 'display_name_encrypted', type: DataType.BLOB })
  declare displayNameEncrypted: string | null;

  @Column({ field: 'given_name_encrypted', type: DataType.BLOB })
  declare givenNameEncrypted: string | null;

  @Column({ field: 'family_name_encrypted', type: DataType.BLOB })
  declare familyNameEncrypted: string | null;

  @Column({ field: 'company_encrypted', type: DataType.BLOB })
  declare companyEncrypted: string | null;

  @Column({ field: 'job_title_encrypted', type: DataType.BLOB })
  declare jobTitleEncrypted: string | null;

  /** Array JSON de `{ label, number }`, cifrado entero. Nunca se consulta por dentro. */
  @Column({ field: 'phones_encrypted', type: DataType.BLOB })
  declare phonesEncrypted: string | null;

  @Column({ field: 'emails_encrypted', type: DataType.BLOB })
  declare emailsEncrypted: string | null;

  @Column({ field: 'addresses_encrypted', type: DataType.BLOB })
  declare addressesEncrypted: string | null;

  @Column({ field: 'display_name_hash', type: DataType.STRING(128) })
  declare displayNameHash: string | null;

  @Column({ field: 'primary_phone_hash', type: DataType.STRING(128) })
  declare primaryPhoneHash: string | null;

  @Column({ field: 'primary_phone_last_4', type: DataType.STRING(4) })
  declare primaryPhoneLast4: string | null;

  @Column({ field: 'phone_hashes', type: DataType.ARRAY(DataType.TEXT) })
  declare phoneHashes: string[];

  @Column({ field: 'email_hashes', type: DataType.ARRAY(DataType.TEXT) })
  declare emailHashes: string[];

  @Column({ field: 'phone_count', type: DataType.INTEGER })
  declare phoneCount: number;

  @Column({ field: 'email_count', type: DataType.INTEGER })
  declare emailCount: number;

  @Column({ field: 'address_count', type: DataType.INTEGER })
  declare addressCount: number;

  @Column({ field: 'birthday', type: DataType.DATEONLY })
  declare birthday: string | null;

  @Column({ field: 'is_favorite', type: DataType.BOOLEAN })
  declare isFavorite: boolean;

  @Column({ field: 'contact_type', type: DataType.STRING(20) })
  declare contactType: string;

  @Column({ field: 'captured_at', type: DataType.DATE, allowNull: false })
  declare capturedAt: Date;

  @Column({ field: 'received_at', type: DataType.DATE, allowNull: false })
  declare receivedAt: Date;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
