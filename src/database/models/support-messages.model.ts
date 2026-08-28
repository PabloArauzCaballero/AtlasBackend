/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business Lo que se dijo en la conversación de soporte, tal como se dijo y en el orden en que se dijo.
 * @system `support.support_messages`, append-only, encadenado por hash e idempotente por `clientMessageId`.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Un mensaje confirmado no se edita, no se reemplaza y no se borra.
 *
 * Corregir es enviar otro mensaje enlazado como `CORRECTS`; redactar un secreto es escribir la
 * versión visible y guardar el original cifrado, dejando el evento de que se redactó. Todo lo demás
 * —editar el texto, borrar la fila— convierte la transcripción en la palabra de quien tenga acceso
 * a la base.
 */
@Table({ tableName: 'support_messages', schema: atlasSchemaFor('support_messages'), timestamps: false })
export class SupportMessageModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'channel_id', type: DataType.BIGINT, allowNull: false })
  declare channelId: string;

  /** Orden determinista dentro del canal. Es también el cursor de paginación. */
  @Column({ field: 'server_sequence', type: DataType.BIGINT, allowNull: false })
  declare serverSequence: string;

  /** Lo genera quien reintenta. Sin él, una mala red duplica el mensaje del cliente. */
  @Column({ field: 'client_message_id', type: DataType.STRING(64), allowNull: false })
  declare clientMessageId: string;

  @Column({ field: 'sender_actor_type', type: DataType.STRING(30), allowNull: false })
  declare senderActorType: string;

  @Column({ field: 'sender_actor_id', type: DataType.STRING(64), allowNull: false })
  declare senderActorId: string;

  @Column({ field: 'sender_agent_profile_id', type: DataType.BIGINT })
  declare senderAgentProfileId: string | null;

  @Column({ field: 'message_type', type: DataType.STRING(40), allowNull: false })
  declare messageType: string;

  /** PUBLIC, INTERNAL o SYSTEM. Filtrar por aquí es lo único que oculta la nota interna. */
  @Column({ field: 'visibility', type: DataType.STRING(20), allowNull: false })
  declare visibility: string;

  @Column({ field: 'body_text', type: DataType.TEXT })
  declare bodyText: string | null;

  @Column({ field: 'body_ciphertext', type: DataType.TEXT })
  declare bodyCiphertext: string | null;

  @Column({ field: 'key_version', type: DataType.STRING(40) })
  declare keyVersion: string | null;

  @Column({ field: 'classification', type: DataType.STRING(20), allowNull: false })
  declare classification: string;

  @Column({ field: 'content_hash', type: DataType.CHAR(64), allowNull: false })
  declare contentHash: string;

  @Column({ field: 'previous_message_hash', type: DataType.CHAR(64) })
  declare previousMessageHash: string | null;

  @Column({ field: 'integrity_hash', type: DataType.CHAR(64), allowNull: false })
  declare integrityHash: string;

  @Column({ field: 'redacted_at', type: DataType.DATE })
  declare redactedAt: Date | null;

  @Column({ field: 'redaction_reason', type: DataType.STRING(200) })
  declare redactionReason: string | null;

  @Column({ field: 'correlation_id', type: DataType.STRING(64) })
  declare correlationId: string | null;

  @Column({ field: 'metadata_json', type: DataType.JSONB })
  declare metadataJson: Record<string, unknown> | null;

  @Column({ field: 'created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
