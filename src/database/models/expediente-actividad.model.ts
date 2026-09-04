/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Quién vio, subió, compartió o borró cada archivo, para poder responderlo cuando se pregunte.
 * @system define la bitácora sólo-añadir del expediente; la base rechaza UPDATE y DELETE.
 */
import { Column, CreatedAt, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'expediente_actividad', schema: atlasSchemaFor('expediente_actividad'), timestamps: true, updatedAt: false })
export class ExpedienteActividadModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'expediente_id', type: DataType.BIGINT, allowNull: false })
  declare expedienteId: string;

  @Column({ field: 'nodo_id', type: DataType.BIGINT })
  declare nodoId: string | null;

  @Column({ field: 'accion', type: DataType.STRING(30), allowNull: false })
  declare accion: string;

  @Column({ field: 'actor_tipo', type: DataType.STRING(20), allowNull: false })
  declare actorTipo: string;

  @Column({ field: 'actor_id', type: DataType.BIGINT })
  declare actorId: string | null;

  @Column({ field: 'request_id', type: DataType.STRING(64) })
  declare requestId: string | null;

  @Column({ field: 'ip', type: DataType.STRING(64) })
  declare ip: string | null;

  @Column({ field: 'detalle', type: DataType.JSONB, allowNull: false })
  declare detalle: Record<string, unknown>;


  /*
   * Sólo `created_at`: esta tabla no se actualiza nunca.
   *
   * La marca la pone Sequelize —no el `DEFAULT NOW()` de la tabla— porque con `allowNull: false` la
   * validación del ORM rechaza el INSERT antes de enviarlo y el defecto de la base no llega a
   * usarse. `updatedAt: false` es lo que impide que el ORM invente una columna que no existe.
   */
  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
