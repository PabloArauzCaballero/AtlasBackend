/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business Los archivos que alguien adjunta a su caso: comprobantes, capturas y evidencias.
 * @system `support.support_attachments`, con hash, escaneo de malware y bloqueo contra borrado.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * El adjunto tiene ciclo de vida propio, por eso no vive dentro del mensaje.
 *
 * Se sube, se escanea, se clasifica y —si es evidencia— se bloquea contra borrado hasta una fecha.
 * Y cuando el archivo es documentación sensible, no viaja por el chat: `evidenceDocumentId` apunta
 * al almacén de evidencia con sus reglas de retención, en vez de crear un segundo almacén sin ellas.
 */
@Table({ tableName: 'support_attachments', schema: atlasSchemaFor('support_attachments'), timestamps: false })
export class SupportAttachmentModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'message_id', type: DataType.BIGINT })
  declare messageId: string | null;

  @Column({ field: 'case_id', type: DataType.BIGINT })
  declare caseId: string | null;

  @Column({ field: 'storage_object_key', type: DataType.STRING(400), allowNull: false })
  declare storageObjectKey: string;

  @Column({ field: 'original_filename', type: DataType.STRING(260), allowNull: false })
  declare originalFilename: string;

  @Column({ field: 'declared_mime', type: DataType.STRING(120) })
  declare declaredMime: string | null;

  @Column({ field: 'detected_mime', type: DataType.STRING(120) })
  declare detectedMime: string | null;

  @Column({ field: 'size_bytes', type: DataType.BIGINT, allowNull: false })
  declare sizeBytes: string;

  @Column({ field: 'sha256', type: DataType.CHAR(64) })
  declare sha256: string | null;

  @Column({ field: 'malware_scan_status', type: DataType.STRING(20), allowNull: false })
  declare malwareScanStatus: string;

  @Column({ field: 'malware_scan_at', type: DataType.DATE })
  declare malwareScanAt: Date | null;

  @Column({ field: 'sensitivity', type: DataType.STRING(20), allowNull: false })
  declare sensitivity: string;

  @Column({ field: 'encryption_key_version', type: DataType.STRING(40) })
  declare encryptionKeyVersion: string | null;

  @Column({ field: 'object_lock_until', type: DataType.DATE })
  declare objectLockUntil: Date | null;

  @Column({ field: 'evidence_document_id', type: DataType.BIGINT })
  declare evidenceDocumentId: string | null;

  @Column({ field: 'uploaded_by_actor_type', type: DataType.STRING(30), allowNull: false })
  declare uploadedByActorType: string;

  @Column({ field: 'uploaded_by_actor_id', type: DataType.STRING(64), allowNull: false })
  declare uploadedByActorId: string;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
