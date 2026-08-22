/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Desenlace observado de un préstamo, en cola hacia el motor de decisión.
 *
 * El motor calcula tasa de malos, falsos rechazos y estabilidad sobre observaciones que alguien
 * tiene que enviarle. Esa entrega se persiste en vez de intentarse y olvidarse: el desenlace de una
 * cosecha es el único dato del sistema que no se puede reconstruir más tarde, así que un motor
 * caído tiene que costar un reintento y no una pérdida definitiva.
 */
@Table({ tableName: 'loan_outcome_reports', schema: atlasSchemaFor('loan_outcome_reports'), timestamps: false })
export class LoanOutcomeReportModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'loan_id', type: DataType.BIGINT, allowNull: false })
  declare loanId: string;

  @Column({ field: 'decision_execution_id', type: DataType.STRING(40), allowNull: false })
  declare decisionExecutionId: string;

  /** Días desde la decisión. Parte de la identidad: 30, 90 y 180 son tres observaciones distintas. */
  @Column({ field: 'window_days', type: DataType.INTEGER, allowNull: false })
  declare windowDays: number;

  @Column({ field: 'label', type: DataType.STRING(40), allowNull: false })
  declare label: string;

  @Column({ field: 'amount', type: DataType.DECIMAL(18, 4) })
  declare amount: string | null;

  @Column({ field: 'source', type: DataType.STRING(120), allowNull: false })
  declare source: string;

  @Column({ field: 'notes', type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'attempts', type: DataType.INTEGER, allowNull: false })
  declare attempts: number;

  @Column({ field: 'last_error', type: DataType.TEXT })
  declare lastError: string | null;

  @Column({ field: 'observed_at', type: DataType.DATE, allowNull: false })
  declare observedAt: Date;

  @Column({ field: 'sent_at', type: DataType.DATE })
  declare sentAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
