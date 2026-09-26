/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza guarda una parte de las corridas QA de N personas (motor de journeys).
 * @system el módulo `qa-orchestration` escribe por SQL con fencing; el modelo deja la tabla con
 *   dueño en el inventario del ORM (AT-018).
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'qa_run_secrets', schema: atlasSchemaFor('qa_run_secrets'), timestamps: false })
export class QaRunSecretModel extends Model {
  @Column({ field: 'run_id', type: DataType.BIGINT, primaryKey: true, allowNull: false })
  declare runId: string;

  @Column({ field: 'mock_run_token_encrypted', type: DataType.TEXT })
  declare mockRunTokenEncrypted: string | null;

  @Column({ field: 'mock_epoch', type: DataType.STRING(64) })
  declare mockEpoch: string | null;

  @Column({ field: 'expires_at', type: DataType.DATE, allowNull: false })
  declare expiresAt: Date;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAt: Date;
}
