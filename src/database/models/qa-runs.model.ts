/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza guarda una parte de las corridas QA de N personas (motor de journeys).
 * @system el módulo `qa-orchestration` escribe por SQL con fencing; el modelo deja la tabla con
 *   dueño en el inventario del ORM (AT-018).
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'qa_runs', schema: atlasSchemaFor('qa_runs'), timestamps: false })
export class QaRunModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'operator_id', type: DataType.STRING(120), allowNull: false })
  declare operatorId: string;

  @Column({ field: 'idempotency_key', type: DataType.STRING(120), allowNull: false })
  declare idempotencyKey: string;

  @Column({ field: 'plan_id', type: DataType.BIGINT, allowNull: false })
  declare planId: string;

  @Column({ field: 'plan_hash', type: DataType.CHAR(64), allowNull: false })
  declare planHash: string;

  @Column({ field: 'plan_snapshot', type: DataType.JSONB, allowNull: false })
  declare planSnapshot: unknown;

  @Column({ field: 'recipe_hash', type: DataType.CHAR(64), allowNull: false })
  declare recipeHash: string;

  @Column({ field: 'template_code', type: DataType.STRING(120), allowNull: false })
  declare templateCode: string;

  @Column({ field: 'template_version', type: DataType.STRING(40), allowNull: false })
  declare templateVersion: string;

  @Column({ field: 'workflow_code', type: DataType.STRING(120), allowNull: false })
  declare workflowCode: string;

  @Column({ field: 'environment_id', type: DataType.STRING(80), allowNull: false })
  declare environmentId: string;

  @Column({ field: 'status', type: DataType.STRING(32), allowNull: false })
  declare status: string;

  @Column({ field: 'verdict', type: DataType.STRING(16) })
  declare verdict: string | null;

  @Column({ field: 'seed', type: DataType.STRING(200), allowNull: false })
  declare seed: string;

  @Column({ field: 'namespace', type: DataType.STRING(80), allowNull: false })
  declare namespace: string;

  @Column({ field: 'reference_date', type: DataType.DATEONLY, allowNull: false })
  declare referenceDate: string;

  @Column({ field: 'generator_version', type: DataType.STRING(60), allowNull: false })
  declare generatorVersion: string;

  @Column({ field: 'job_run_id', type: DataType.BIGINT })
  declare jobRunId: string | null;

  @Column({ field: 'parent_run_id', type: DataType.BIGINT })
  declare parentRunId: string | null;

  @Column({ field: 'counters_json', type: DataType.JSONB, allowNull: false })
  declare countersJson: unknown;

  @Column({ field: 'evidence_json', type: DataType.JSONB, allowNull: false })
  declare evidenceJson: unknown;

  @Column({ field: 'requests_issued', type: DataType.INTEGER, allowNull: false })
  declare requestsIssued: number;

  @Column({ field: 'error_message', type: DataType.TEXT })
  declare errorMessage: string | null;

  @Column({ field: 'cancel_requested_at', type: DataType.DATE })
  declare cancelRequestedAt: Date | null;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @Column({ field: 'finished_at', type: DataType.DATE })
  declare finishedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;
}
