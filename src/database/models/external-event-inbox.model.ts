/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza recuerda qué evento de otro servicio (el ERP) ya se recibió y qué se hizo con él.
 * @system `external_event_inbox` (P-14): unicidad (producer, event_key); la escribe `ErpEventInboxService` por SQL.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'external_event_inbox', schema: atlasSchemaFor('external_event_inbox'), timestamps: false })
export class ExternalEventInboxModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'producer', type: DataType.STRING(40), allowNull: false })
  declare producer: string;

  @Column({ field: 'event_key', type: DataType.STRING(200), allowNull: false })
  declare eventKey: string;

  @Column({ field: 'topic', type: DataType.STRING(120), allowNull: false })
  declare topic: string;

  @Column({ field: 'schema_version', type: DataType.INTEGER, allowNull: false })
  declare schemaVersion: number;

  @Column({ field: 'aggregate_type', type: DataType.STRING(80), allowNull: false })
  declare aggregateType: string;

  @Column({ field: 'aggregate_id', type: DataType.STRING(120), allowNull: false })
  declare aggregateId: string;

  @Column({ field: 'aggregate_version', type: DataType.BIGINT, allowNull: false })
  declare aggregateVersion: string;

  @Column({ field: 'outcome', type: DataType.STRING(20), allowNull: false })
  declare outcome: 'APPLIED' | 'IGNORED' | 'STALE' | 'UNLINKED';

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'payload', type: DataType.JSONB, allowNull: false })
  declare payload: Record<string, unknown>;

  @Column({ field: 'occurred_at', type: DataType.DATE, allowNull: false })
  declare occurredAt: Date;

  @Column({ field: 'received_at', type: DataType.DATE, allowNull: false })
  declare receivedAt: Date;
}
