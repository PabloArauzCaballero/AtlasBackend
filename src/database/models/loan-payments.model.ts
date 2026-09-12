/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Cobro recibido contra un préstamo.
 *
 * Un pago no se borra ni se edita: se reversa. `status = 'reversed'` con su motivo deja el rastro
 * de que el dinero entró y volvió a salir, que es lo que un cheque devuelto o un contracargo
 * significan de verdad.
 */
@Table({ tableName: 'loan_payments', schema: atlasSchemaFor('loan_payments'), timestamps: false })
export class LoanPaymentModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'loan_id', type: DataType.BIGINT, allowNull: false })
  declare loanId: string;

  @Column({ field: 'payment_code', type: DataType.STRING(40), allowNull: false })
  declare paymentCode: string;

  @Column({ field: 'amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare amount: string;

  @Column({ field: 'currency_code', type: DataType.STRING(3), allowNull: false })
  declare currencyCode: string;

  @Column({ field: 'payment_method', type: DataType.STRING(40), allowNull: false })
  declare paymentMethod: string;

  @Column({ field: 'external_reference', type: DataType.STRING(160) })
  declare externalReference: string | null;

  @Column({ field: 'received_at', type: DataType.DATE, allowNull: false })
  declare receivedAt: Date;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'reversed_at', type: DataType.DATE })
  declare reversedAt: Date | null;

  @Column({ field: 'reversal_reason_code', type: DataType.STRING(120) })
  declare reversalReasonCode: string | null;

  @Column({ field: 'registered_by_internal_user_id', type: DataType.BIGINT })
  declare registeredByInternalUserId: string | null;

  @Column({ field: 'idempotency_key_hash', type: DataType.STRING(128) })
  declare idempotencyKeyHash: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
