/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Una campaña de notificación: qué se dice, a quién, por qué canales y durante qué ventana.
 * @system `notification_campaigns` guarda la audiencia CONGELADA al programar, el cursor de
 *   materialización y los contadores; los mensajes individuales viven en `notification_messages`.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'notification_campaigns', schema: atlasSchemaFor('notification_campaigns'), timestamps: false })
export class NotificationCampaignModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'campaign_uuid', type: DataType.UUID, allowNull: false })
  declare campaignUuid: string;

  @Column({ field: 'name', type: DataType.STRING(140), allowNull: false })
  declare name: string;

  @Column({ field: 'purpose', type: DataType.STRING(20), allowNull: false })
  declare purpose: string;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'title', type: DataType.STRING(200), allowNull: false })
  declare title: string;

  @Column({ field: 'body', type: DataType.TEXT, allowNull: false })
  declare body: string;

  @Column({ field: 'category', type: DataType.STRING(60), allowNull: false })
  declare category: string;

  @Column({ field: 'icon', type: DataType.STRING(60) })
  declare icon: string | null;

  @Column({ field: 'deep_link', type: DataType.STRING(300) })
  declare deepLink: string | null;

  @Column({ field: 'channels', type: DataType.JSONB, allowNull: false })
  declare channels: string[];

  @Column({ field: 'audience_segment_id', type: DataType.BIGINT })
  declare audienceSegmentId: string | null;

  @Column({ field: 'audience_definition_json', type: DataType.JSONB, allowNull: false })
  declare audienceDefinitionJson: Record<string, unknown>;

  @Column({ field: 'audience_estimate_json', type: DataType.JSONB })
  declare audienceEstimateJson: Record<string, unknown> | null;

  @Column({ field: 'starts_at', type: DataType.DATE })
  declare startsAt: Date | null;

  @Column({ field: 'ends_at', type: DataType.DATE })
  declare endsAt: Date | null;

  @Column({ field: 'timezone', type: DataType.STRING(60), allowNull: false })
  declare timezone: string;

  @Column({ field: 'rate_per_minute', type: DataType.INTEGER, allowNull: false })
  declare ratePerMinute: number;

  @Column({ field: 'max_recipients', type: DataType.INTEGER })
  declare maxRecipients: number | null;

  @Column({ field: 'audience_cursor', type: DataType.STRING(40) })
  declare audienceCursor: string | null;

  @Column({ field: 'materialized_at', type: DataType.DATE })
  declare materializedAt: Date | null;

  @Column({ field: 'targeted_count', type: DataType.INTEGER, allowNull: false })
  declare targetedCount: number;

  @Column({ field: 'created_count', type: DataType.INTEGER, allowNull: false })
  declare createdCount: number;

  @Column({ field: 'created_by', type: DataType.STRING(120) })
  declare createdBy: string | null;

  @Column({ field: 'scheduled_by', type: DataType.STRING(120) })
  declare scheduledBy: string | null;

  @Column({ field: 'scheduled_at', type: DataType.DATE })
  declare scheduledAt: Date | null;

  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date | null;

  @Column({ field: 'paused_at', type: DataType.DATE })
  declare pausedAt: Date | null;

  @Column({ field: 'finished_at', type: DataType.DATE })
  declare finishedAt: Date | null;

  @Column({ field: 'cancelled_at', type: DataType.DATE })
  declare cancelledAt: Date | null;

  @Column({ field: 'cancel_reason', type: DataType.STRING(400) })
  declare cancelReason: string | null;

  @Column({ field: 'last_error', type: DataType.STRING(400) })
  declare lastError: string | null;

  @Column({ field: 'idempotency_key', type: DataType.STRING(180) })
  declare idempotencyKey: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
