/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza guarda el compromiso de recalcular la capacidad de pago con el extracto subido.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'bank_statement_reviews', schema: atlasSchemaFor('bank_statement_reviews'), timestamps: false })
export class BankStatementReviewModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  /** Referencia al archivo CIFRADO. El contenido no vive en esta tabla. */
  @Column({ field: 'evidence_document_id', type: DataType.BIGINT, allowNull: true })
  declare evidenceDocumentId: string | null;

  @Column({ field: 'storage_key', type: DataType.STRING(500), allowNull: true })
  declare storageKey: string | null;

  @Column({ field: 'status', type: DataType.STRING(24), allowNull: false })
  declare status: string;

  /** El plazo prometido al cliente. Se escribe al recibir: es un compromiso, no una observación. */
  @Column({ field: 'promised_by', type: DataType.DATE, allowNull: false })
  declare promisedBy: Date;

  @Column({ field: 'nsf_count', type: DataType.INTEGER, allowNull: true })
  declare nsfCount: number | null;

  @Column({ field: 'observed_monthly_income', type: DataType.DECIMAL(18, 2), allowNull: true })
  declare observedMonthlyIncome: string | null;

  @Column({ field: 'observed_monthly_expense', type: DataType.DECIMAL(18, 2), allowNull: true })
  declare observedMonthlyExpense: string | null;

  @Column({ field: 'applied_credit_line_id', type: DataType.BIGINT, allowNull: true })
  declare appliedCreditLineId: string | null;

  @Column({ field: 'rejection_reason', type: DataType.STRING(200), allowNull: true })
  declare rejectionReason: string | null;

  /*
   * El veredicto del motor, en tres columnas porque responden a tres preguntas.
   *
   * `engineErrorCode` es el código técnico con el que se busca el caso;
   * `rejectionCategory` es la categoría con la que se mide cuál pesa;
   * `rejectionMessage` es la frase que la persona lee y que le dice qué hacer.
   * Antes había una sola cadena puesta por este backend —`STATEMENT_NOT_READABLE`—
   * y con ella la app decía lo mismo tanto si el documento era una factura de la
   * luz como si era un PDF editado o cubría un mes en vez de tres.
   */
  @Column({ field: 'engine_request_id', type: DataType.STRING(64), allowNull: true })
  declare engineRequestId: string | null;

  @Column({ field: 'engine_status', type: DataType.STRING(32), allowNull: true })
  declare engineStatus: string | null;

  @Column({ field: 'engine_error_code', type: DataType.STRING(120), allowNull: true })
  declare engineErrorCode: string | null;

  @Column({ field: 'rejection_category', type: DataType.STRING(40), allowNull: true })
  declare rejectionCategory: string | null;

  @Column({ field: 'rejection_message', type: DataType.TEXT, allowNull: true })
  declare rejectionMessage: string | null;

  @Column({ field: 'review_reason', type: DataType.STRING(40), allowNull: true })
  declare reviewReason: string | null;

  /** Si el archivo es el que emitió el banco o lo fabricó alguien. */
  @Column({ field: 'authenticity_verdict', type: DataType.STRING(16), allowNull: true })
  declare authenticityVerdict: string | null;

  @Column({ field: 'authenticity_score', type: DataType.SMALLINT, allowNull: true })
  declare authenticityScore: number | null;

  @Column({ field: 'institution_code', type: DataType.STRING(16), allowNull: true })
  declare institutionCode: string | null;

  @Column({ field: 'institution_name', type: DataType.STRING(200), allowNull: true })
  declare institutionName: string | null;

  /** La evaluación completa del motor, para auditar la resta renglón a renglón. */
  @Column({ field: 'affordability_json', type: DataType.JSONB, allowNull: true })
  declare affordabilityJson: Record<string, unknown> | null;

  @Column({ field: 'affordability_eligible', type: DataType.BOOLEAN, allowNull: true })
  declare affordabilityEligible: boolean | null;

  @Column({ field: 'affordability_score', type: DataType.SMALLINT, allowNull: true })
  declare affordabilityScore: number | null;

  @Column({ field: 'affordability_band', type: DataType.STRING(16), allowNull: true })
  declare affordabilityBand: string | null;

  @Column({ field: 'months_complete', type: DataType.SMALLINT, allowNull: true })
  declare monthsComplete: number | null;

  @Column({ field: 'monthly_obligations', type: DataType.DECIMAL(18, 2), allowNull: true })
  declare monthlyObligations: string | null;

  @Column({ field: 'max_affordable_installment', type: DataType.DECIMAL(18, 2), allowNull: true })
  declare maxAffordableInstallment: string | null;

  @Column({ field: 'income_stability_score', type: DataType.SMALLINT, allowNull: true })
  declare incomeStabilityScore: number | null;

  @Column({ field: 'period_from', type: DataType.DATEONLY, allowNull: true })
  declare periodFrom: string | null;

  @Column({ field: 'period_to', type: DataType.DATEONLY, allowNull: true })
  declare periodTo: string | null;

  @Column({ field: 'reviewed_by_internal_user_id', type: DataType.BIGINT, allowNull: true })
  declare reviewedByInternalUserId: string | null;

  @Column({ field: 'reviewed_at', type: DataType.DATE, allowNull: true })
  declare reviewedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
