/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'customer_risk_ratings', schema: atlasSchemaFor('customer_risk_ratings'), timestamps: false })
export class CustomerRiskRatingModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'policy_version_id', type: DataType.BIGINT, allowNull: false })
  declare policyVersionId: string;

  @Column({ field: 'grade', type: DataType.STRING(4), allowNull: false })
  declare grade: string;

  @Column({ field: 'grade_label', type: DataType.STRING(60), allowNull: false })
  declare gradeLabel: string;

  @Column({ field: 'severity_rank', type: DataType.INTEGER, allowNull: false })
  declare severityRank: number;

  @Column({ field: 'worst_days_past_due', type: DataType.INTEGER, allowNull: false })
  declare worstDaysPastDue: number;

  @Column({ field: 'rated_loan_count', type: DataType.INTEGER, allowNull: false })
  declare ratedLoanCount: number;

  @Column({ field: 'total_exposure_amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare totalExposureAmount: string;

  @Column({ field: 'total_provision_amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare totalProvisionAmount: string;

  /** El crédito que fijó la categoría por arrastre. Es la respuesta a «¿por qué me bajaron?». */
  @Column({ field: 'driving_loan_id', type: DataType.BIGINT })
  declare drivingLoanId: string | null;

  @Column({ field: 'previous_grade', type: DataType.STRING(4) })
  declare previousGrade: string | null;

  @Column({ field: 'rating_reason', type: DataType.STRING(40), allowNull: false })
  declare ratingReason: string;

  @Column({ field: 'is_current', type: DataType.BOOLEAN, allowNull: false })
  declare isCurrent: boolean;

  @Column({ field: 'rated_at', type: DataType.DATE, allowNull: false })
  declare ratedAt: Date;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
