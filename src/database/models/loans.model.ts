/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Préstamo desembolsado: lo que existe DESPUÉS de aprobar una solicitud.
 *
 * `decision_execution_id` es la arista al motor de decisión. Sin ella el desenlace real —pagó,
 * cayó en mora, se castigó— no se puede atribuir a la versión del artefacto que tomó la decisión,
 * y el monitoreo continuo del motor queda midiendo sobre una población que no puede identificar.
 */
@Table({ tableName: 'loans', schema: atlasSchemaFor('loans'), timestamps: false })
export class LoanModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'loan_code', type: DataType.STRING(40), allowNull: false })
  declare loanCode: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'credit_application_id', type: DataType.BIGINT, allowNull: false })
  declare creditApplicationId: string;

  @Column({ field: 'credit_product_id', type: DataType.BIGINT, allowNull: false })
  declare creditProductId: string;

  @Column({ field: 'currency_code', type: DataType.STRING(3), allowNull: false })
  declare currencyCode: string;

  @Column({ field: 'principal_amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare principalAmount: string;

  @Column({ field: 'annual_interest_rate', type: DataType.DECIMAL(7, 4), allowNull: false })
  declare annualInterestRate: string;

  @Column({ field: 'term_months', type: DataType.INTEGER, allowNull: false })
  declare termMonths: number;

  @Column({ field: 'status', type: DataType.STRING(30), allowNull: false })
  declare status: string;

  @Column({ field: 'disbursed_at', type: DataType.DATE })
  declare disbursedAt: Date | null;

  @Column({ field: 'first_due_date', type: DataType.DATEONLY })
  declare firstDueDate: string | null;

  @Column({ field: 'maturity_date', type: DataType.DATEONLY })
  declare maturityDate: string | null;

  @Column({ field: 'scheduled_principal', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare scheduledPrincipal: string;

  @Column({ field: 'scheduled_interest', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare scheduledInterest: string;

  @Column({ field: 'paid_principal', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare paidPrincipal: string;

  @Column({ field: 'paid_interest', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare paidInterest: string;

  @Column({ field: 'paid_late_fee', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare paidLateFee: string;

  @Column({ field: 'outstanding_principal', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare outstandingPrincipal: string;

  @Column({ field: 'days_past_due', type: DataType.INTEGER, allowNull: false })
  declare daysPastDue: number;

  /** El peor momento vivido, que no se borra cuando el cliente se pone al día: eso es el historial. */
  @Column({ field: 'worst_days_past_due', type: DataType.INTEGER, allowNull: false })
  declare worstDaysPastDue: number;

  @Column({ field: 'delinquency_bucket', type: DataType.STRING(20), allowNull: false })
  declare delinquencyBucket: string;

  @Column({ field: 'delinquency_evaluated_at', type: DataType.DATE })
  declare delinquencyEvaluatedAt: Date | null;

  @Column({ field: 'closed_at', type: DataType.DATE })
  declare closedAt: Date | null;

  @Column({ field: 'written_off_at', type: DataType.DATE })
  declare writtenOffAt: Date | null;

  @Column({ field: 'written_off_amount', type: DataType.DECIMAL(18, 2) })
  declare writtenOffAmount: string | null;

  @Column({ field: 'write_off_reason_code', type: DataType.STRING(120) })
  declare writeOffReasonCode: string | null;

  @Column({ field: 'decision_execution_id', type: DataType.STRING(40) })
  declare decisionExecutionId: string | null;

  @Column({ field: 'decision_artifact_version_id', type: DataType.STRING(40) })
  declare decisionArtifactVersionId: string | null;

  @Column({ field: 'decision_subject_reference', type: DataType.STRING(128) })
  declare decisionSubjectReference: string | null;

  @Column({ field: 'disbursed_by_internal_user_id', type: DataType.BIGINT })
  declare disbursedByInternalUserId: string | null;

  @Column({ field: 'idempotency_key_hash', type: DataType.STRING(128) })
  declare idempotencyKeyHash: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
