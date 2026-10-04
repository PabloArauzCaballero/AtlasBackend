/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'data_subject_requests', schema: atlasSchemaFor('data_subject_requests'), timestamps: false })
export class DataSubjectRequestModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'request_code', type: DataType.STRING(80) })
  declare requestCode: string | null;

  @Column({ field: 'customer_id', type: DataType.BIGINT })
  declare customerId: string | null;

  @Column({ field: 'request_type', type: DataType.STRING(60) })
  declare requestType: string | null;

  @Column({ field: 'status', type: DataType.STRING(40) })
  declare status: string | null;

  @Column({ field: 'requested_at', type: DataType.DATE })
  declare requestedAt: Date | null;

  @Column({ field: 'due_at', type: DataType.DATE })
  declare dueAt: Date | null;

  @Column({ field: 'resolved_at', type: DataType.DATE })
  declare resolvedAt: Date | null;

  @Column({ field: 'handled_by', type: DataType.BIGINT })
  declare handledBy: string | null;

  @Column({ field: 'resolution_notes', type: DataType.TEXT })
  declare resolutionNotes: string | null;

  /** Lo que la persona escribió al pedir. Antes se aceptaba en la API y se tiraba. */
  @Column({ field: 'description', type: DataType.TEXT })
  declare description: string | null;

  /** Qué campo quiere corregir (vocabulario cerrado de `RECTIFICATION_FIELDS`); NULL en un borrado. */
  @Column({ field: 'rectification_field', type: DataType.STRING(40) })
  declare rectificationField: string | null;

  /** El valor propuesto, en un sobre cifrado (`encryptSecretEnvelope`). Nunca en claro. */
  @Column({ field: 'proposed_value_encrypted', type: DataType.BLOB })
  declare proposedValueEncrypted: Buffer | null;

  /** Cuándo confirmó el PIN la persona antes de pedir (la constancia la pone el servidor, no la app). */
  @Column({ field: 'pin_verified_at', type: DataType.DATE })
  declare pinVerifiedAt: Date | null;

  /** `shadow`: el Motor opina y una persona decide. Nulo mientras el Motor no ha opinado. */
  @Column({ field: 'decision_mode', type: DataType.STRING(10) })
  declare decisionMode: string | null;

  /** ACEPTAR, RECHAZAR o REVISION_HUMANA, tal como lo publicó el artefacto. */
  @Column({ field: 'engine_decision', type: DataType.STRING(20) })
  declare engineDecision: string | null;

  @Column({ field: 'engine_reason_code', type: DataType.STRING(60) })
  declare engineReasonCode: string | null;

  @Column({ field: 'engine_action', type: DataType.STRING(30) })
  declare engineAction: string | null;

  @Column({ field: 'engine_risk_signals', type: DataType.SMALLINT })
  declare engineRiskSignals: number | null;

  @Column({ field: 'engine_reevaluate_credit', type: DataType.BOOLEAN })
  declare engineReevaluateCredit: boolean | null;

  /** Las variables que se mandaron (sin datos personales): la explicación de la decisión. */
  @Column({ field: 'engine_inputs_json', type: DataType.JSONB })
  declare engineInputsJson: Record<string, unknown> | null;

  @Column({ field: 'engine_execution_id', type: DataType.STRING(100) })
  declare engineExecutionId: string | null;

  @Column({ field: 'engine_artifact_code', type: DataType.STRING(120) })
  declare engineArtifactCode: string | null;

  @Column({ field: 'engine_artifact_version_id', type: DataType.STRING(60) })
  declare engineArtifactVersionId: string | null;

  @Column({ field: 'engine_decided_at', type: DataType.DATE })
  declare engineDecidedAt: Date | null;

  @Column({ field: 'engine_attempts', type: DataType.SMALLINT, allowNull: false, defaultValue: 0 })
  declare engineAttempts: number;

  @Column({ field: 'engine_last_error', type: DataType.STRING(300) })
  declare engineLastError: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN })
  declare deleted: boolean | null;
}
