/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza guarda una parte de las corridas QA de N personas (motor de journeys).
 * @system el módulo `qa-orchestration` escribe por SQL con fencing; el modelo deja la tabla con
 *   dueño en el inventario del ORM (AT-018).
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'qa_worker_heartbeats', schema: atlasSchemaFor('qa_worker_heartbeats'), timestamps: false })
export class QaWorkerHeartbeatModel extends Model {
  @Column({ field: 'worker_id', type: DataType.STRING(160), primaryKey: true, allowNull: false })
  declare workerId: string;

  @Column({ field: 'last_seen_at', type: DataType.DATE, allowNull: false })
  declare lastSeenAt: Date;

  @Column({ field: 'version', type: DataType.STRING(80) })
  declare version: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAt: Date;
}
