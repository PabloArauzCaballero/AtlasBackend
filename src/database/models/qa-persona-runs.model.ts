/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza guarda una parte de las corridas QA de N personas (motor de journeys).
 * @system el módulo `qa-orchestration` escribe por SQL con fencing; el modelo deja la tabla con
 *   dueño en el inventario del ORM (AT-018).
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'qa_persona_runs', schema: atlasSchemaFor('qa_persona_runs'), timestamps: false })
export class QaPersonaRunModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'run_id', type: DataType.BIGINT, allowNull: false })
  declare runId: string;

  @Column({ field: 'ordinal', type: DataType.INTEGER, allowNull: false })
  declare ordinal: number;

  @Column({ field: 'persona_key', type: DataType.STRING(40), allowNull: false })
  declare personaKey: string;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'case_category', type: DataType.STRING(20) })
  declare caseCategory: string | null;

  @Column({ field: 'archetype', type: DataType.STRING(40) })
  declare archetype: string | null;

  @Column({ field: 'dataset_hash', type: DataType.CHAR(64) })
  declare datasetHash: string | null;

  @Column({ field: 'resources_json', type: DataType.JSONB, allowNull: false })
  declare resourcesJson: unknown;

  @Column({ field: 'failed_step_key', type: DataType.STRING(120) })
  declare failedStepKey: string | null;

  @Column({ field: 'reason', type: DataType.TEXT })
  declare reason: string | null;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @Column({ field: 'finished_at', type: DataType.DATE })
  declare finishedAt: Date | null;
}
