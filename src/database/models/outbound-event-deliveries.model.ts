/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza garantiza que el aviso de pago confirmado en Core llegue al ERP aunque la red falle.
 * @system `outbound_event_deliveries` (P-14): una fila por (destino, evento), nacida en la transacción del evento.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'outbound_event_deliveries', schema: atlasSchemaFor('outbound_event_deliveries'), timestamps: false })
export class OutboundEventDeliveryModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'destination', type: DataType.STRING(40), allowNull: false })
  declare destination: string;

  @Column({ field: 'event_id', type: DataType.UUID, allowNull: false })
  declare eventId: string;

  @Column({ field: 'event_code', type: DataType.STRING(120), allowNull: false })
  declare eventCode: string;

  @Column({ field: 'aggregate_type', type: DataType.STRING(80), allowNull: false })
  declare aggregateType: string;

  @Column({ field: 'aggregate_id', type: DataType.STRING(120), allowNull: false })
  declare aggregateId: string;

  @Column({ field: 'aggregate_version', type: DataType.BIGINT, allowNull: false })
  declare aggregateVersion: string;

  @Column({ field: 'envelope', type: DataType.JSONB, allowNull: false })
  declare envelope: Record<string, unknown>;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: 'pending' | 'delivered' | 'dead';

  @Column({ field: 'attempts', type: DataType.INTEGER, allowNull: false })
  declare attempts: number;

  @Column({ field: 'next_attempt_at', type: DataType.DATE, allowNull: false })
  declare nextAttemptAt: Date;

  @Column({ field: 'lease_owner', type: DataType.STRING(80) })
  declare leaseOwner: string | null;

  @Column({ field: 'lease_expires_at', type: DataType.DATE })
  declare leaseExpiresAt: Date | null;

  @Column({ field: 'last_error', type: DataType.STRING(300) })
  declare lastError: string | null;

  @Column({ field: 'last_http_status', type: DataType.INTEGER })
  declare lastHttpStatus: number | null;

  @Column({ field: 'delivered_at', type: DataType.DATE })
  declare deliveredAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
