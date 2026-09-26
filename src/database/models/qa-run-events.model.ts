/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza guarda una parte de las corridas QA de N personas (motor de journeys).
 * @system el módulo `qa-orchestration` escribe por SQL con fencing; el modelo deja la tabla con
 *   dueño en el inventario del ORM (AT-018).
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'qa_run_events', schema: atlasSchemaFor('qa_run_events'), timestamps: false })
export class QaRunEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'run_id', type: DataType.BIGINT, allowNull: false })
  declare runId: string;

  @Column({ field: 'sequence', type: DataType.INTEGER, allowNull: false })
  declare sequence: number;

  @Column({ field: 'event_type', type: DataType.STRING(60), allowNull: false })
  declare eventType: string;

  @Column({ field: 'payload_json', type: DataType.JSONB, allowNull: false })
  declare payloadJson: unknown;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAt: Date;
}
