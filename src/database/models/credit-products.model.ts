/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Catálogo de productos crediticios.
 *
 * Es DATO, no código: montos, plazos, tasas y requisitos los administra el área de negocio. El
 * backend impone la estructura y la coherencia de los rangos; no decide condiciones comerciales.
 */
@Table({ tableName: 'credit_products', schema: atlasSchemaFor('credit_products'), timestamps: false })
export class CreditProductModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'product_code', type: DataType.STRING(60), allowNull: false })
  declare productCode: string;

  @Column({ field: 'product_name', type: DataType.STRING(180), allowNull: false })
  declare productName: string;

  @Column({ field: 'description', type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'currency_code', type: DataType.STRING(3), allowNull: false })
  declare currencyCode: string;

  @Column({ field: 'min_amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare minAmount: string;

  @Column({ field: 'max_amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare maxAmount: string;

  @Column({ field: 'min_term_months', type: DataType.INTEGER, allowNull: false })
  declare minTermMonths: number;

  @Column({ field: 'max_term_months', type: DataType.INTEGER, allowNull: false })
  declare maxTermMonths: number;

  @Column({ field: 'annual_interest_rate', type: DataType.DECIMAL(7, 4) })
  declare annualInterestRate: string | null;

  /** Umbral de ingreso declarado; se contrasta contra `customer_attribute_values`. */
  @Column({ field: 'min_monthly_income', type: DataType.DECIMAL(18, 2) })
  declare minMonthlyIncome: string | null;

  @Column({ field: 'requires_manual_review', type: DataType.BOOLEAN, allowNull: false })
  declare requiresManualReview: boolean;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'effective_from', type: DataType.DATE })
  declare effectiveFrom: Date | null;

  @Column({ field: 'effective_until', type: DataType.DATE })
  declare effectiveUntil: Date | null;

  @Column({ field: 'created_by_internal_user_id', type: DataType.BIGINT })
  declare createdByInternalUserId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
