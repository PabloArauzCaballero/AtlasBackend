/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business La historia del expediente: cada asignación, escalamiento, cierre y reapertura, con autor.
 * @system `support.support_case_events`, append-only y encadenado por hash. Sin UPDATE ni DELETE.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Cómo se llegó al estado actual, que la fila del caso ya no puede contar.
 *
 * Cada evento firma el hash del anterior: quitar el escalamiento incómodo del medio rompe todo lo
 * que viene después. La cadena no impide el borrado —eso lo hace el trigger append-only—, lo hace
 * DEMOSTRABLE, que es lo que sirve ante un reclamo.
 */
@Table({ tableName: 'support_case_events', schema: atlasSchemaFor('support_case_events'), timestamps: false })
export class SupportCaseEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'case_id', type: DataType.BIGINT, allowNull: false })
  declare caseId: string;

  @Column({ field: 'sequence_number', type: DataType.BIGINT, allowNull: false })
  declare sequenceNumber: string;

  @Column({ field: 'event_type', type: DataType.STRING(60), allowNull: false })
  declare eventType: string;

  @Column({ field: 'actor_type', type: DataType.STRING(30), allowNull: false })
  declare actorType: string;

  @Column({ field: 'actor_id', type: DataType.STRING(64) })
  declare actorId: string | null;

  @Column({ field: 'occurred_at', type: DataType.DATE, allowNull: false })
  declare occurredAt: Date;

  @Column({ field: 'payload_json', type: DataType.JSONB, allowNull: false })
  declare payloadJson: Record<string, unknown>;

  @Column({ field: 'previous_hash', type: DataType.CHAR(64) })
  declare previousHash: string | null;

  @Column({ field: 'event_hash', type: DataType.CHAR(64), allowNull: false })
  declare eventHash: string;

  @Column({ field: 'correlation_id', type: DataType.STRING(64) })
  declare correlationId: string | null;

  @Column({ field: 'causation_id', type: DataType.STRING(64) })
  declare causationId: string | null;
}
