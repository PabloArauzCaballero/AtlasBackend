/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza guarda una parte de las corridas QA de N personas (motor de journeys).
 * @system el módulo `qa-orchestration` escribe por SQL con fencing; el modelo deja la tabla con
 *   dueño en el inventario del ORM (AT-018).
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'qa_run_resources', schema: atlasSchemaFor('qa_run_resources'), timestamps: false })
export class QaRunResourceModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'run_id', type: DataType.BIGINT, allowNull: false })
  declare runId: string;

  @Column({ field: 'persona_key', type: DataType.STRING(40) })
  declare personaKey: string | null;

  @Column({ field: 'service', type: DataType.STRING(60), allowNull: false })
  declare service: string;

  @Column({ field: 'resource_type', type: DataType.STRING(60), allowNull: false })
  declare resourceType: string;

  @Column({ field: 'resource_id', type: DataType.STRING(120), allowNull: false })
  declare resourceId: string;

  @Column({ field: 'cleanup_strategy', type: DataType.STRING(40), allowNull: false })
  declare cleanupStrategy: string;

  @Column({ field: 'cleanup_result', type: DataType.STRING(40) })
  declare cleanupResult: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAt: Date;
}
