/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Un permiso de subida acotado, para que un archivo entre sin pasar por la API.
 * @system define el ticket firmado y su consumo; sin él, una subida abandonada deja un huérfano.
 */
import { Column, CreatedAt, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'expediente_tickets_subida', schema: atlasSchemaFor('expediente_tickets_subida'), timestamps: true, updatedAt: false })
export class ExpedienteTicketSubidaModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'expediente_id', type: DataType.BIGINT, allowNull: false })
  declare expedienteId: string;

  @Column({ field: 'parent_id', type: DataType.BIGINT })
  declare parentId: string | null;

  @Column({ field: 'nombre_previsto', type: DataType.STRING(255), allowNull: false })
  declare nombrePrevisto: string;

  @Column({ field: 'mime_type', type: DataType.STRING(100), allowNull: false })
  declare mimeType: string;

  @Column({ field: 'size_bytes', type: DataType.BIGINT, allowNull: false })
  declare sizeBytes: string;

  @Column({ field: 'sha256_declarado', type: DataType.CHAR(64) })
  declare sha256Declarado: string | null;

  @Column({ field: 'storage_key', type: DataType.TEXT, allowNull: false })
  declare storageKey: string;

  @Column({ field: 'emitido_por_id', type: DataType.BIGINT })
  declare emitidoPorId: string | null;

  @Column({ field: 'vence_en', type: DataType.DATE, allowNull: false })
  declare venceEn: Date;

  @Column({ field: 'consumido_en', type: DataType.DATE })
  declare consumidoEn: Date | null;


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
