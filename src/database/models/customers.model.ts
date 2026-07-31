/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'customers', schema: atlasSchemaFor('customers'), timestamps: false })
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

  /**
   * Estado del ciclo de vida. Desde la migración `20260728090000` es NOT NULL con CHECK sobre el
   * conjunto de `CUSTOMER_LIFECYCLE_STATUSES`; su único escritor autorizado es
   * `CustomerLifecycleService`.
   */
  @Column({ field: 'lifecycle_status', type: DataType.STRING(40), allowNull: false })
  declare lifecycleStatus: string;

  /** Caché del estado derivado de habilitación. La fuente de verdad es el cálculo del servicio. */
  @Column({ field: 'credit_eligibility_status', type: DataType.STRING(40) })
  declare creditEligibilityStatus: string | null;

  @Column({ field: 'eligibility_evaluated_at', type: DataType.DATE })
  declare eligibilityEvaluatedAt: Date | null;

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
