import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'notification_deliveries', timestamps: false })
export class NotificationDeliveryModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'notification_message_id', type: DataType.BIGINT, allowNull: false })
  declare notificationMessageId: string;

  @Column({ field: 'channel', type: DataType.STRING(40), allowNull: false })
  declare channel: string;

  @Column({ field: 'provider', type: DataType.STRING(80), allowNull: false })
  declare provider: string;

  @Column({ field: 'provider_message_id', type: DataType.STRING(180) })
  declare providerMessageId: string | null;

  @Column({ field: 'status', type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: 'attempt_number', type: DataType.INTEGER, allowNull: false })
  declare attemptNumber: number;

  @Column({ field: 'error_code', type: DataType.STRING(120) })
  declare errorCode: string | null;

  @Column({ field: 'error_message', type: DataType.TEXT })
  declare errorMessage: string | null;

  @Column({ field: 'request_payload_json', type: DataType.JSONB })
  declare requestPayloadJson: Record<string, unknown> | null;

  @Column({ field: 'response_payload_json', type: DataType.JSONB })
  declare responsePayloadJson: Record<string, unknown> | null;

  @Column({ field: 'sent_at', type: DataType.DATE })
  declare sentAt: Date | null;

  @Column({ field: 'delivered_at', type: DataType.DATE })
  declare deliveredAt: Date | null;

  @Column({ field: 'failed_at', type: DataType.DATE })
  declare failedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
