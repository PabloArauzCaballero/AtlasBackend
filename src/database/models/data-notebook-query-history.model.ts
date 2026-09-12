/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Historial del cuaderno: qué se preguntó, nunca qué se obtuvo.
 *
 * No hay campo donde quepa un resultado, y es deliberado: guardarlo convertiría el historial en
 * una segunda copia de los datos personales, fuera de `read_api`, sin enmascarado y sin
 * caducidad. Sin la columna no hay que acordarse de no llenarla.
 */
@Table({
  tableName: 'data_notebook_query_history',
  schema: atlasSchemaFor('data_notebook_query_history'),
  timestamps: false,
})
export class DataNotebookQueryHistoryModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'actor_user_id', type: DataType.STRING(80) })
  declare actorUserId: string | null;

  @Column({ field: 'actor_role', type: DataType.STRING(80) })
  declare actorRole: string | null;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare language: string;

  /** El código de la celda. Es texto y no se ejecuta NUNCA en el servidor. */
  @Column({ type: DataType.TEXT, allowNull: false })
  declare source: string;

  @Column({ field: 'dataset_code', type: DataType.STRING(64) })
  declare datasetCode: string | null;

  @Column({ field: 'dataset_page', type: DataType.INTEGER })
  declare datasetPage: number | null;

  @Column({ field: 'row_count', type: DataType.INTEGER })
  declare rowCount: number | null;

  @Column({ field: 'duration_ms', type: DataType.INTEGER })
  declare durationMs: number | null;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'error_message', type: DataType.STRING(500) })
  declare errorMessage: string | null;

  @Column({ field: 'created_at', type: DataType.DATE, allowNull: false })
  declare createdAt: Date;
}
