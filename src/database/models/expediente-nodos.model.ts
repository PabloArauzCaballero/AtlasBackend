/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Cada carpeta y cada archivo del expediente, con su origen y si está congelado.
 * @system define el nodo del árbol; un archivo REFERENCIA un objeto del almacén, no lo posee.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'expediente_nodos', schema: atlasSchemaFor('expediente_nodos'), timestamps: false })
export class ExpedienteNodoModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'expediente_id', type: DataType.BIGINT, allowNull: false })
  declare expedienteId: string;

  @Column({ field: 'parent_id', type: DataType.BIGINT })
  declare parentId: string | null;

  @Column({ field: 'tipo', type: DataType.STRING(10), allowNull: false })
  declare tipo: string;

  @Column({ field: 'nombre', type: DataType.STRING(255), allowNull: false })
  declare nombre: string;

  @Column({ field: 'ruta', type: DataType.TEXT, allowNull: false })
  declare ruta: string;

  @Column({ field: 'origen', type: DataType.STRING(20), allowNull: false })
  declare origen: string;

  @Column({ field: 'clase', type: DataType.STRING(30) })
  declare clase: string | null;

  @Column({ field: 'storage_key', type: DataType.TEXT })
  declare storageKey: string | null;

  @Column({ field: 'storage_bucket', type: DataType.STRING(120) })
  declare storageBucket: string | null;

  @Column({ field: 'sha256', type: DataType.CHAR(64) })
  declare sha256: string | null;

  @Column({ field: 'mime_type', type: DataType.STRING(100) })
  declare mimeType: string | null;

  @Column({ field: 'size_bytes', type: DataType.BIGINT })
  declare sizeBytes: string | null;

  @Column({ field: 'evidence_document_id', type: DataType.BIGINT })
  declare evidenceDocumentId: string | null;

  @Column({ field: 'engine_request_id', type: DataType.STRING(64) })
  declare engineRequestId: string | null;

  @Column({ field: 'objeto_ausente', type: DataType.BOOLEAN, allowNull: false })
  declare objetoAusente: boolean;

  /** Se compone desde la base al pedirlo; no tiene objeto en el almacén. Ver la migración. */
  @Column({ field: 'virtual', type: DataType.BOOLEAN, allowNull: false })
  declare virtual: boolean;

  @Column({ field: 'inmutable', type: DataType.BOOLEAN, allowNull: false })
  declare inmutable: boolean;

  @Column({ field: 'creado_por_tipo', type: DataType.STRING(20), allowNull: false })
  declare creadoPorTipo: string;

  @Column({ field: 'creado_por_id', type: DataType.BIGINT })
  declare creadoPorId: string | null;

  @Column({ field: 'created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: 'updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;

  @Column({ field: 'borrado_en', type: DataType.DATE })
  declare borradoEn: Date | null;

  @Column({ field: 'borrado_por_id', type: DataType.BIGINT })
  declare borradoPorId: string | null;
}
