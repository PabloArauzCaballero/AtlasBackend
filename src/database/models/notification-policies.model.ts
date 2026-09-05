/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza decide qué avisos puede apagar el cliente y cuáles no.
 * @system mapea el catálogo de políticas de notificación por evento y canal.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'notification_policies', schema: atlasSchemaFor('notification_policies'), timestamps: false })
export class NotificationPolicyModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'event_code', type: DataType.STRING(80), allowNull: false })
  declare eventCode: string;

  @Column({ field: 'channel', type: DataType.STRING(24), allowNull: false })
  declare channel: string;

  @Column({ field: 'label', type: DataType.STRING(120), allowNull: false })
  declare label: string;

  @Column({ field: 'description', type: DataType.STRING(400) })
  declare description: string | null;

  @Column({ field: 'category', type: DataType.STRING(40), allowNull: false })
  declare category: string;

  @Column({ field: 'icon', type: DataType.STRING(40) })
  declare icon: string | null;

  @Column({ field: 'is_mandatory', type: DataType.BOOLEAN, allowNull: false })
  declare isMandatory: boolean;

  @Column({ field: 'default_enabled', type: DataType.BOOLEAN, allowNull: false })
  declare defaultEnabled: boolean;

  @Column({ field: 'mandatory_reason', type: DataType.STRING(400) })
  declare mandatoryReason: string | null;

  @Column({ field: 'display_order', type: DataType.INTEGER, allowNull: false })
  declare displayOrder: number;

  @Column({ field: 'is_active', type: DataType.BOOLEAN, allowNull: false })
  declare isActive: boolean;

  @Column({ field: 'updated_by_internal_user_id', type: DataType.BIGINT })
  declare updatedByInternalUserId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
