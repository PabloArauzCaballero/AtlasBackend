/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'loan_risk_ratings', schema: atlasSchemaFor('loan_risk_ratings'), timestamps: false })
export class LoanRiskRatingModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'loan_id', type: DataType.BIGINT, allowNull: false })
  declare loanId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  /** Con qué matriz se calificó. Sin esto la calificación no es reproducible seis meses después. */
  @Column({ field: 'policy_version_id', type: DataType.BIGINT, allowNull: false })
  declare policyVersionId: string;

  @Column({ field: 'grade', type: DataType.STRING(4), allowNull: false })
  declare grade: string;

  @Column({ field: 'grade_label', type: DataType.STRING(60), allowNull: false })
  declare gradeLabel: string;

  @Column({ field: 'severity_rank', type: DataType.INTEGER, allowNull: false })
  declare severityRank: number;

  @Column({ field: 'days_past_due', type: DataType.INTEGER, allowNull: false })
  declare daysPastDue: number;

  @Column({ field: 'delinquency_bucket', type: DataType.STRING(20), allowNull: false })
  declare delinquencyBucket: string;

  @Column({ field: 'exposure_amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare exposureAmount: string;

  @Column({ field: 'provision_rate', type: DataType.DECIMAL(6, 4), allowNull: false })
  declare provisionRate: string;

  @Column({ field: 'provision_amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare provisionAmount: string;

  @Column({ field: 'previous_grade', type: DataType.STRING(4) })
  declare previousGrade: string | null;

  @Column({ field: 'rating_reason', type: DataType.STRING(40), allowNull: false })
  declare ratingReason: string;

  /** Puntero al presente sobre una tabla append-only: la calificación vigente es una sola. */
  @Column({ field: 'is_current', type: DataType.BOOLEAN, allowNull: false })
  declare isCurrent: boolean;

  @Column({ field: 'rated_at', type: DataType.DATE, allowNull: false })
  declare ratedAt: Date;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
