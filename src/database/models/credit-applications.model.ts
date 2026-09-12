/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Solicitud de crédito.
 *
 * `eligibility_evaluation_id` + `eligibility_snapshot_json` son la pieza que hace defendible la
 * operación: apuntan a la evaluación concreta que autorizó la solicitud y congelan su resultado. Sin
 * ese par, demostrar meses después con qué información se aceptó exige reconstruir a mano el estado
 * del cliente en esa fecha.
 */
@Table({ tableName: 'credit_applications', schema: atlasSchemaFor('credit_applications'), timestamps: false })
export class CreditApplicationModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'application_code', type: DataType.STRING(40), allowNull: false })
  declare applicationCode: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'credit_product_id', type: DataType.BIGINT, allowNull: false })
  declare creditProductId: string;

  /** El comercio donde nació la solicitud. Nulo en las anteriores al vínculo: no se puede inventar. */
  @Column({ field: 'partner_profile_id', type: DataType.BIGINT })
  declare partnerProfileId: string | null;

  /** La caja del comercio donde se escaneó el QR. De ella cuelga la sucursal. Nulo si no nació en una. */
  @Column({ field: 'pos_terminal_id', type: DataType.BIGINT })
  declare posTerminalId: string | null;

  @Column({ field: 'requested_amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare requestedAmount: string;

  @Column({ field: 'requested_term_months', type: DataType.INTEGER, allowNull: false })
  declare requestedTermMonths: number;

  @Column({ field: 'currency_code', type: DataType.STRING(3), allowNull: false })
  declare currencyCode: string;

  @Column({ field: 'purpose_code', type: DataType.STRING(80) })
  declare purposeCode: string | null;

  @Column({ field: 'status', type: DataType.STRING(30), allowNull: false })
  declare status: string;

  @Column({ field: 'eligibility_evaluation_id', type: DataType.BIGINT })
  declare eligibilityEvaluationId: string | null;

  @Column({ field: 'eligibility_snapshot_json', type: DataType.JSONB, allowNull: false })
  declare eligibilitySnapshotJson: unknown;

  @Column({ field: 'risk_assessment_run_id', type: DataType.BIGINT })
  declare riskAssessmentRunId: string | null;

  /**
   * Qué ejecución del motor resolvió la solicitud, y con qué versión del artefacto.
   *
   * Es el eslabón que ata la decisión al dinero y, más tarde, al resultado. Sin él, el desenlace
   * real del préstamo no se puede atribuir a la política que lo autorizó.
   */
  @Column({ field: 'decision_execution_id', type: DataType.STRING(40) })
  declare decisionExecutionId: string | null;

  @Column({ field: 'decision_artifact_version_id', type: DataType.STRING(40) })
  declare decisionArtifactVersionId: string | null;

  @Column({ field: 'decision_subject_reference', type: DataType.STRING(128) })
  declare decisionSubjectReference: string | null;

  /** Cómo se resolvió: el motor, una persona, o una persona porque el motor no estaba. */
  @Column({ field: 'decision_mode', type: DataType.STRING(30) })
  declare decisionMode: string | null;

  @Column({ field: 'decision_score', type: DataType.DECIMAL(12, 4) })
  declare decisionScore: string | null;

  @Column({ field: 'decision_risk_band', type: DataType.STRING(40) })
  declare decisionRiskBand: string | null;

  @Column({ field: 'decision_reasons_json', type: DataType.JSONB })
  declare decisionReasonsJson: unknown;

  @Column({ field: 'decision_reason_code', type: DataType.STRING(120) })
  declare decisionReasonCode: string | null;

  /**
   * Qué dijo el NEGOCIO sobre una solicitud que el motor ya aprobó: `pending`, `accepted` o
   * `declined`. Nulo cuando no aplica —la aprobó una persona, o no llegó a aprobarse—.
   *
   * Son dos preguntas distintas: el motor responde si el solicitante cumple los criterios de
   * riesgo; el negocio, si quiere esa operación ahora —cupo, concentración, liquidez, una campaña
   * que se cerró—. Un motor que decide las dos deja al negocio sin volante.
   */
  @Column({ field: 'business_acceptance', type: DataType.STRING(20) })
  declare businessAcceptance: string | null;

  @Column({ field: 'business_acceptance_at', type: DataType.DATE })
  declare businessAcceptanceAt: Date | null;

  @Column({ field: 'business_acceptance_by', type: DataType.STRING(160) })
  declare businessAcceptanceBy: string | null;

  /** Obligatorio al declinar: una operación rechazada que nadie sabe explicar es la que se reclama. */
  @Column({ field: 'business_acceptance_reason_code', type: DataType.STRING(120) })
  declare businessAcceptanceReasonCode: string | null;

  @Column({ field: 'business_acceptance_notes', type: DataType.TEXT })
  declare businessAcceptanceNotes: string | null;

  @Column({ field: 'decided_at', type: DataType.DATE })
  declare decidedAt: Date | null;

  @Column({ field: 'decided_by_internal_user_id', type: DataType.BIGINT })
  declare decidedByInternalUserId: string | null;

  @Column({ field: 'idempotency_key_hash', type: DataType.STRING(128) })
  declare idempotencyKeyHash: string | null;

  @Column({ field: 'submitted_at', type: DataType.DATE, allowNull: false })
  declare submittedAt: Date;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
