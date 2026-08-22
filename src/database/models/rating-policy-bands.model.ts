/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'rating_policy_bands', schema: atlasSchemaFor('rating_policy_bands'), timestamps: false })
export class RatingPolicyBandModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'policy_version_id', type: DataType.BIGINT, allowNull: false })
  declare policyVersionId: string;

  @Column({ field: 'grade', type: DataType.STRING(4), allowNull: false })
  declare grade: string;

  @Column({ field: 'grade_label', type: DataType.STRING(60), allowNull: false })
  declare gradeLabel: string;

  /** Orden de severidad: 0 es la mejor categoría. Es lo que decide el arrastre al calificar al cliente. */
  @Column({ field: 'severity_rank', type: DataType.INTEGER, allowNull: false })
  declare severityRank: number;

  @Column({ field: 'min_days_past_due', type: DataType.INTEGER, allowNull: false })
  declare minDaysPastDue: number;

  /** `null` = banda abierta, la última de la escala. */
  @Column({ field: 'max_days_past_due', type: DataType.INTEGER })
  declare maxDaysPastDue: number | null;

  /** Tanto por uno. `NUMERIC` llega como string para no perder precisión al pasar por JavaScript. */
  @Column({ field: 'provision_rate', type: DataType.DECIMAL(6, 4), allowNull: false })
  declare provisionRate: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
