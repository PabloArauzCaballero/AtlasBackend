import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'notification_messages', timestamps: false })
export class NotificationMessageModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT })
  declare tenantId: string | null;

  @Column({ field: 'outbox_event_id', type: DataType.BIGINT })
  declare outboxEventId: string | null;

  @Column({ field: 'recipient_type', type: DataType.STRING(40), allowNull: false })
  declare recipientType: string;

  @Column({ field: 'recipient_id', type: DataType.STRING(120), allowNull: false })
  declare recipientId: string;

  @Column({ field: 'channel', type: DataType.STRING(40), allowNull: false })
  declare channel: string;

  @Column({ field: 'template_code', type: DataType.STRING(160) })
  declare templateCode: string | null;

  @Column({ field: 'subject', type: DataType.TEXT })
  declare subject: string | null;

  @Column({ field: 'title', type: DataType.TEXT })
  declare title: string | null;

  @Column({ field: 'body', type: DataType.TEXT, allowNull: false })
  declare body: string;

  @Column({ field: 'payload_json', type: DataType.JSONB })
  declare payloadJson: Record<string, unknown> | null;

  @Column({ field: 'delivery_targets_json', type: DataType.JSONB })
  declare deliveryTargetsJson: Array<Record<string, unknown>> | null;

  @Column({ field: 'status', type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: 'priority', type: DataType.INTEGER, allowNull: false })
  declare priority: number;

  @Column({ field: 'scheduled_at', type: DataType.DATE })
  declare scheduledAt: Date | null;

  @Column({ field: 'queued_at', type: DataType.DATE })
  declare queuedAt: Date | null;

  @Column({ field: 'sent_at', type: DataType.DATE })
  declare sentAt: Date | null;

  @Column({ field: 'delivered_at', type: DataType.DATE })
  declare deliveredAt: Date | null;

  @Column({ field: 'read_at', type: DataType.DATE })
  declare readAt: Date | null;

  @Column({ field: 'failed_at', type: DataType.DATE })
  declare failedAt: Date | null;

  @Column({ field: 'cancelled_at', type: DataType.DATE })
  declare cancelledAt: Date | null;

  @Column({ field: 'idempotency_key', type: DataType.STRING(180) })
  declare idempotencyKey: string | null;

  @Column({ field: 'correlation_id', type: DataType.STRING(120) })
  declare correlationId: string | null;

  @Column({ field: 'causation_id', type: DataType.STRING(120) })
  declare causationId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
