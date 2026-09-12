/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Cómo se repartió UN cobro entre las cuotas y los conceptos.
 *
 * Es la pieza que hace reconstruible el saldo. Con sólo un acumulado por cuota, reversar un pago
 * obliga a adivinar de dónde salió cada céntimo; con esta tabla, deshacerlo es leer sus filas y
 * restarlas.
 */
@Table({
  tableName: 'loan_payment_allocations',
  schema: atlasSchemaFor('loan_payment_allocations'),
  timestamps: false,
})
export class LoanPaymentAllocationModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'loan_payment_id', type: DataType.BIGINT, allowNull: false })
  declare loanPaymentId: string;

  @Column({ field: 'loan_installment_id', type: DataType.BIGINT, allowNull: false })
  declare loanInstallmentId: string;

  @Column({ field: 'principal_applied', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare principalApplied: string;

  @Column({ field: 'interest_applied', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare interestApplied: string;

  @Column({ field: 'late_fee_applied', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare lateFeeApplied: string;

  @Column({ field: 'reversed', type: DataType.BOOLEAN, allowNull: false })
  declare reversed: boolean;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
