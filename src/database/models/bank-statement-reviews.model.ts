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
