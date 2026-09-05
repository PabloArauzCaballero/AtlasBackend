/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business El aviso del cliente de que pagó por transferencia, esperando que el comercio lo confirme.
 * @system `credit.loan_payment_claims`, con su comprobante en `evidence_documents`.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Un reclamo de pago: alguien AFIRMA haber pagado, y todavía nadie lo ha comprobado.
 *
 * No es un pago. Nace `pending_verification`, no mueve un centavo, y sólo cuando el comercio dice
 * que ese dinero entró en su cuenta se registra el `loan_payment` de verdad —que queda enlazado en
 * `loanPaymentId`—. Esa separación es lo que impide que una captura de pantalla salde una cuota.
 */
@Table({ tableName: 'loan_payment_claims', schema: atlasSchemaFor('loan_payment_claims'), timestamps: false })
export class LoanPaymentClaimModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'claim_code', type: DataType.STRING(60), allowNull: false })
  declare claimCode: string;

  @Column({ field: 'loan_id', type: DataType.BIGINT, allowNull: false })
  declare loanId: string;

  @Column({ field: 'installment_id', type: DataType.BIGINT, allowNull: false })
  declare installmentId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  /** El comercio que tiene que verificarlo: es el dueño de la cuenta a la que se transfirió. */
  @Column({ field: 'partner_profile_id', type: DataType.BIGINT })
  declare partnerProfileId: string | null;

  @Column({ field: 'claimed_amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare claimedAmount: string;

  @Column({ field: 'currency_code', type: DataType.STRING(3), allowNull: false })
  declare currencyCode: string;

  /** La referencia que el cliente copió de su banco. Es lo que el comercio busca en su extracto. */
  @Column({ field: 'payer_reference', type: DataType.STRING(160) })
  declare payerReference: string | null;

  @Column({ field: 'proof_evidence_id', type: DataType.BIGINT })
  declare proofEvidenceId: string | null;

  @Column({ field: 'status', type: DataType.STRING(30), allowNull: false })
  declare status: string;

  @Column({ field: 'submitted_at', type: DataType.DATE, allowNull: false })
  declare submittedAt: Date;

  @Column({ field: 'decided_at', type: DataType.DATE })
  declare decidedAt: Date | null;

  @Column({ field: 'decided_by_merchant_user_id', type: DataType.BIGINT })
  declare decidedByMerchantUserId: string | null;

  @Column({ field: 'rejection_reason', type: DataType.STRING(300) })
  declare rejectionReason: string | null;

  /** El pago que este reclamo produjo. Nulo mientras nadie lo haya verificado. */
  @Column({ field: 'loan_payment_id', type: DataType.BIGINT })
  declare loanPaymentId: string | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
