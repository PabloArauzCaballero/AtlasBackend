/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'system_test_runs', schema: atlasSchemaFor('system_test_runs'), timestamps: false })
export class SystemTestRunModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'suite_id', type: DataType.BIGINT, allowNull: false })
  declare suiteId: string;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare environment: string;

  @Column({ field: 'triggered_by', type: DataType.STRING(80) })
  declare triggeredBy: string | null;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @Column({ field: 'finished_at', type: DataType.DATE })
  declare finishedAt: Date | null;

  @Column({ field: 'duration_ms', type: DataType.INTEGER })
  declare durationMs: number | null;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare summary: Record<string, unknown>;

  @Column({ field: 'logs_url', type: DataType.TEXT })
  declare logsUrl: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
