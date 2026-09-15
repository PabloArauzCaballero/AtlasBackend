/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Cuota del cronograma.
 *
 * Los importes pagados se llevan separados por concepto (capital, interés, mora) y no como un
 * único acumulado: la prelación con la que se aplica un cobro es una decisión de negocio, y con un
 * solo número no se puede ni auditar ni reversar.
 */
@Table({ tableName: 'loan_installments', schema: atlasSchemaFor('loan_installments'), timestamps: false })
export class LoanInstallmentModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'loan_id', type: DataType.BIGINT, allowNull: false })
  declare loanId: string;

  @Column({ field: 'installment_number', type: DataType.INTEGER, allowNull: false })
  declare installmentNumber: number;

  @Column({ field: 'due_date', type: DataType.DATEONLY, allowNull: false })
  declare dueDate: string;

  @Column({ field: 'principal_amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare principalAmount: string;

  @Column({ field: 'interest_amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare interestAmount: string;

  @Column({ field: 'late_fee_amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare lateFeeAmount: string;

  @Column({ field: 'paid_principal', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare paidPrincipal: string;

  @Column({ field: 'paid_interest', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare paidInterest: string;

  @Column({ field: 'paid_late_fee', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare paidLateFee: string;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'days_past_due', type: DataType.INTEGER, allowNull: false })
  declare daysPastDue: number;

  @Column({ field: 'settled_at', type: DataType.DATE })
  declare settledAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
