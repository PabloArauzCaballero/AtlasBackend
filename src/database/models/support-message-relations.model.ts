/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business Qué mensaje corrige, responde o redacta a otro dentro de la misma conversación.
 * @system `support.support_message_relations`, append-only: la corrección es una relación, no una edición.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Esta tabla es la razón por la que no hace falta un `PUT /messages/{id}`.
 *
 * Cuando un agente se equivoca, el mensaje original se queda —porque el cliente ya lo leyó y actuó
 * en consecuencia— y el nuevo queda enlazado como `CORRECTS`. La interfaz puede marcar el anterior
 * como «corregido después» sin tocar una sola letra de su contenido.
 */
@Table({ tableName: 'support_message_relations', schema: atlasSchemaFor('support_message_relations'), timestamps: false })
export class SupportMessageRelationModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'message_id', type: DataType.BIGINT, allowNull: false })
  declare messageId: string;

  @Column({ field: 'related_message_id', type: DataType.BIGINT, allowNull: false })
  declare relatedMessageId: string;

  @Column({ field: 'relation_type', type: DataType.STRING(30), allowNull: false })
  declare relationType: string;

  @Column({ field: 'created_by_actor_id', type: DataType.STRING(64) })
  declare createdByActorId: string | null;
}
