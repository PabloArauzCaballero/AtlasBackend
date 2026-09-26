/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * El último estado de consentimiento que el motor debe conocer por sujeto y finalidad (P-09).
 *
 * `pending` hasta que el motor lo acusa; `synced` después. Una revocación que el motor no recibió
 * sigue `pending` y es lo que el desembolso lee para NO originar mientras tanto: el motor no puede
 * ejercer un permiso retirado que no conoce, así que el core lo ejerce por él.
 */
@Table({ tableName: 'decision_consent_replications', schema: atlasSchemaFor('decision_consent_replications'), timestamps: false })
export class DecisionConsentReplicationModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'subject_reference', type: DataType.STRING(128), allowNull: false })
  declare subjectReference: string;

  @Column({ field: 'purpose_code', type: DataType.STRING(100), allowNull: false })
  declare purposeCode: string;

  @Column({ field: 'action', type: DataType.STRING(10), allowNull: false })
  declare action: 'grant' | 'revoke';

  @Column({ field: 'basis', type: DataType.STRING(40) })
  declare basis: string | null;

  @Column({ field: 'granted_at', type: DataType.DATE })
  declare grantedAt: Date | null;

  @Column({ field: 'expires_at', type: DataType.DATE })
  declare expiresAt: Date | null;

  @Column({ field: 'source_consent_id', type: DataType.BIGINT })
  declare sourceConsentId: string | null;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: 'pending' | 'synced' | 'superseded';

  @Column({ field: 'attempts', type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare attempts: number;

  @Column({ field: 'next_attempt_at', type: DataType.DATE, allowNull: false })
  declare nextAttemptAt: Date;

  @Column({ field: 'last_error', type: DataType.TEXT })
  declare lastError: string | null;

  @Column({ field: 'requested_at', type: DataType.DATE, allowNull: false })
  declare requestedAt: Date;

  /** Por qué quedó `superseded` (p. ej. `CONSENT_GRANT_REPLAYED`). */
  @Column({ field: 'resolution_code', type: DataType.STRING(60) })
  declare resolutionCode: string | null;

  /** Versión del texto bajo la que se otorgó, si Core la conoce. */
  @Column({ field: 'consent_version', type: DataType.STRING(40) })
  declare consentVersion: string | null;

  @Column({ field: 'synced_at', type: DataType.DATE })
  declare syncedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
