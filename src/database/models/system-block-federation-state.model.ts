/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Bitácora de la federación del catálogo, una fila por bloque del ecosistema.
 *
 * Existe para que «no veo las tablas del ERP» tenga siempre una respuesta con nombre: nunca se
 * intentó, no está configurado, se intentó y no contestó, contestó 401, o se logró en tal instante
 * y trajo tantas filas. Sin esta bitácora los cinco casos se ven exactamente igual desde el portal
 * —una lista vacía— y el operador acaba adivinando si el problema es del ERP, de la red o de una
 * variable de entorno que nadie puso.
 */
@Table({
  tableName: 'system_block_federation_state',
  schema: atlasSchemaFor('system_block_federation_state'),
  timestamps: false,
})
export class SystemBlockFederationStateModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'system_code', type: DataType.STRING(60), allowNull: false, unique: true })
  declare systemCode: string;

  @Column({ field: 'last_attempt_at', type: DataType.DATE })
  declare lastAttemptAt: Date | null;

  @Column({ field: 'last_success_at', type: DataType.DATE })
  declare lastSuccessAt: Date | null;

  /** `NEVER_RUN` | `NOT_CONFIGURED` | `OK` | `UNREACHABLE` | `UNAUTHORIZED` | `INVALID_MANIFEST` | `ERROR`. */
  @Column({ field: 'last_status', type: DataType.STRING(40), allowNull: false, defaultValue: 'NEVER_RUN' })
  declare lastStatus: string;

  @Column({ field: 'last_message', type: DataType.TEXT })
  declare lastMessage: string | null;

  @Column({ field: 'endpoints_imported', type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare endpointsImported: number;

  @Column({ field: 'data_entities_imported', type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare dataEntitiesImported: number;

  @Column({ field: 'remote_version', type: DataType.STRING(60) })
  declare remoteVersion: string | null;

  @Column({ field: 'remote_commit', type: DataType.STRING(80) })
  declare remoteCommit: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
