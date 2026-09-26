/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza guarda una parte de las corridas QA de N personas (motor de journeys).
 * @system el módulo `qa-orchestration` escribe por SQL con fencing; el modelo deja la tabla con
 *   dueño en el inventario del ORM (AT-018).
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'qa_step_runs', schema: atlasSchemaFor('qa_step_runs'), timestamps: false })
export class QaStepRunModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'persona_run_id', type: DataType.BIGINT, allowNull: false })
  declare personaRunId: string;

  @Column({ field: 'run_id', type: DataType.BIGINT, allowNull: false })
  declare runId: string;

  @Column({ field: 'step_key', type: DataType.STRING(120), allowNull: false })
  declare stepKey: string;

  @Column({ field: 'workflow_step_code', type: DataType.STRING(120) })
  declare workflowStepCode: string | null;

  @Column({ field: 'visit_index', type: DataType.INTEGER, allowNull: false })
  declare visitIndex: number;

  @Column({ field: 'logical_operation_id', type: DataType.CHAR(32), allowNull: false })
  declare logicalOperationId: string;

  @Column({ field: 'status', type: DataType.STRING(24), allowNull: false })
  declare status: string;

  @Column({ field: 'branch', type: DataType.STRING(160) })
  declare branch: string | null;

  @Column({ field: 'reason', type: DataType.TEXT })
  declare reason: string | null;

  @Column({ field: 'root_cause_step_key', type: DataType.STRING(120) })
  declare rootCauseStepKey: string | null;

  @Column({ field: 'failures_json', type: DataType.JSONB, allowNull: false })
  declare failuresJson: unknown;

  @Column({ field: 'attempts_json', type: DataType.JSONB, allowNull: false })
  declare attemptsJson: unknown;

  @Column({ field: 'evidence_json', type: DataType.JSONB, allowNull: false })
  declare evidenceJson: unknown;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @Column({ field: 'finished_at', type: DataType.DATE })
  declare finishedAt: Date | null;
}
