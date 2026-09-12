/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza recuerda qué evento ya procesó cada consumidor para que un reintento no lo repita.
 * @system define el inbox de recibos por consumidor (AT-022): unicidad (consumer_id, event_id).
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'inbox_receipts', schema: atlasSchemaFor('inbox_receipts'), timestamps: false })
export class InboxReceiptModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'consumer_id', type: DataType.STRING(120), allowNull: false })
  declare consumerId: string;

  @Column({ field: 'event_id', type: DataType.UUID, allowNull: false })
  declare eventId: string;

  @Column({ field: 'producer', type: DataType.STRING(80) })
  declare producer: string | null;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'attempts', type: DataType.INTEGER, allowNull: false })
  declare attempts: number;

  @Column({ field: 'last_error', type: DataType.TEXT })
  declare lastError: string | null;

  @Column({ field: 'processed_at', type: DataType.DATE })
  declare processedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
