/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business El expediente reúne los archivos de una persona bajo una sola carpeta gobernable.
 * @system define el modelo del expediente y su estado dentro del ciclo del alta.
 */
import { Column, CreatedAt, DataType, Model, Table, UpdatedAt } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'expedientes', schema: atlasSchemaFor('expedientes'), timestamps: true })
export class ExpedienteModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'subject_type', type: DataType.STRING(30), allowNull: false })
  declare subjectType: string;

  @Column({ field: 'subject_id', type: DataType.BIGINT, allowNull: false })
  declare subjectId: string;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'customer_code', type: DataType.STRING(60) })
  declare customerCode: string | null;

  @Column({ field: 'estado', type: DataType.STRING(20), allowNull: false })
  declare estado: string;

  @Column({ field: 'enviado_en', type: DataType.DATE })
  declare enviadoEn: Date | null;

  @Column({ field: 'manifest_nodo_id', type: DataType.BIGINT })
  declare manifestNodoId: string | null;

  @Column({ field: 'retencion_hasta', type: DataType.DATE })
  declare retencionHasta: Date | null;

  @Column({ field: 'creado_por_tipo', type: DataType.STRING(20), allowNull: false })
  declare creadoPorTipo: string;

  @Column({ field: 'creado_por_id', type: DataType.BIGINT })
  declare creadoPorId: string | null;


  /*
   * Las marcas de tiempo las pone Sequelize, no el `DEFAULT NOW()` de la tabla.
   *
   * Con `timestamps: false` y las columnas declaradas `allowNull: false`, la validación del ORM
   * rechazaba el INSERT antes de enviarlo —«createdAtValue cannot be null»— y el gancho del alta
   * fallaba en silencio: el cliente se creaba y su carpeta no. El defecto de la base nunca llegaba
   * a usarse porque la fila no salía del proceso.
   *
   * Dejarlo en manos del ORM arregla además un segundo defecto más callado: `updated_at` no lo
   * tocaba nadie, así que la columna «Modificado» de la pantalla habría mostrado para siempre la
   * fecha de creación.
   */
  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;

  @Column({ field: 'purgado_en', type: DataType.DATE })
  declare purgadoEn: Date | null;
}
