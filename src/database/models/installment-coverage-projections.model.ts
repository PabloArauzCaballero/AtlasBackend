/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza deja consultable en Core lo que ATLAS cubrió de una cuota y cuánto recuperó el ERP.
 * @system `installment_coverage_projections` (P-14): proyección por CxC de recuperación del ERP; no es saldo.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'installment_coverage_projections', schema: atlasSchemaFor('installment_coverage_projections'), timestamps: false })
export class InstallmentCoverageProjectionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'erp_recovery_id', type: DataType.UUID, allowNull: false })
  declare erpRecoveryId: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'loan_id', type: DataType.BIGINT })
  declare loanId: string | null;

  @Column({ field: 'installment_id', type: DataType.BIGINT })
  declare installmentId: string | null;

  @Column({ field: 'partner_profile_id', type: DataType.BIGINT })
  declare partnerProfileId: string | null;

  @Column({ field: 'erp_installment_id', type: DataType.UUID, allowNull: false })
  declare erpInstallmentId: string;

  @Column({ field: 'erp_payable_id', type: DataType.UUID })
  declare erpPayableId: string | null;

  @Column({ field: 'settlement_reference', type: DataType.STRING(120) })
  declare settlementReference: string | null;

  @Column({ field: 'amount_covered', type: DataType.DECIMAL(18, 2) })
  declare amountCovered: string | null;

  @Column({ field: 'amount_recovered', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare amountRecovered: string;

  @Column({ field: 'currency_code', type: DataType.STRING(3) })
  declare currencyCode: string | null;

  @Column({ field: 'coverage_paid_at', type: DataType.DATE })
  declare coveragePaidAt: Date | null;

  @Column({ field: 'recovery_status', type: DataType.STRING(30), allowNull: false })
  declare recoveryStatus: string;

  @Column({ field: 'recovery_version', type: DataType.BIGINT, allowNull: false })
  declare recoveryVersion: string;

  @Column({ field: 'settled_event_key', type: DataType.STRING(200) })
  declare settledEventKey: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
