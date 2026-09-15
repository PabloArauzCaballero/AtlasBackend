/**
 * @file Repositorio de campañas, segmentos y de los mensajes que genera una campaña.
 * @business Guarda qué se programó, a quién se le generó cada aviso y en qué quedó cada uno.
 * @system Las transiciones de estado se hacen con `UPDATE ... WHERE status = <esperado>`: dos
 *   procesos que intentan arrancar la misma campaña no pueden ganar los dos.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, type WhereOptions } from 'sequelize';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';
import { NotificationAudienceSegmentModel, NotificationCampaignModel, NotificationMessageModel } from '../../../database/models/index.js';
import type { ListCampaignsQueryDto } from './notification-campaigns.schemas.js';

export type CampaignMessageStat = { channel: string; status: string; count: number; read: number };

const INSERT_CHUNK = 1_000;

@Injectable()
export class NotificationCampaignsRepository {
  constructor(
    @InjectModel(NotificationCampaignModel) private readonly campaigns: typeof NotificationCampaignModel,
    @InjectModel(NotificationAudienceSegmentModel) private readonly segments: typeof NotificationAudienceSegmentModel,
    @InjectModel(NotificationMessageModel) private readonly messages: typeof NotificationMessageModel,
  ) {}

  createCampaign(values: Record<string, unknown>): Promise<NotificationCampaignModel> {
    const now = new Date();
    return this.campaigns.create({ ...values, createdAtValue: now, updatedAtValue: now } as never);
  }

  findCampaign(tenantId: string, campaignId: string): Promise<NotificationCampaignModel | null> {
    return this.campaigns.findOne({ where: { tenantId, id: campaignId } });
  }

  findCampaignByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<NotificationCampaignModel | null> {
    return this.campaigns.findOne({ where: { tenantId, idempotencyKey } });
  }

  listCampaigns(tenantId: string, query: ListCampaignsQueryDto) {
    const where: Record<string | symbol, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.search) where[Op.or] = [{ name: { [Op.iLike]: `%${query.search}%` } }, { title: { [Op.iLike]: `%${query.search}%` } }];
    return this.campaigns.findAndCountAll({
      where: where as WhereOptions,
      order: [
        ['createdAtValue', 'DESC'],
        ['id', 'DESC'],
      ],
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    });
  }

  async saveCampaign(campaign: NotificationCampaignModel, patch: Record<string, unknown>): Promise<NotificationCampaignModel> {
    campaign.set({ ...patch, updatedAtValue: new Date() });
    return campaign.save();
  }

  /** Transición condicional: sólo aplica si la campaña sigue en uno de los estados esperados. */
  async transition(campaignId: string, from: readonly string[], patch: Record<string, unknown>): Promise<boolean> {
    const [affected] = await this.campaigns.update({ ...patch, updatedAtValue: new Date() } as never, {
      where: { id: campaignId, status: { [Op.in]: [...from] } } as WhereOptions,
    });
    return affected > 0;
  }

  listDueToStart(tenantId: string, now: Date, limit: number): Promise<NotificationCampaignModel[]> {
    return this.campaigns.findAll({
      where: { tenantId, status: 'scheduled', startsAt: { [Op.lte]: now } } as WhereOptions,
      order: [['startsAt', 'ASC']],
      limit,
    });
  }

  listRunning(tenantId: string, limit: number): Promise<NotificationCampaignModel[]> {
    return this.campaigns.findAll({ where: { tenantId, status: 'running' }, order: [['startedAt', 'ASC']], limit });
  }

  /** Inserta los avisos de una tanda. El índice único parcial descarta los que ya existían (reintento idempotente). */
  async insertCampaignMessages(rows: Array<Record<string, unknown>>): Promise<number> {
    let inserted = 0;
    for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
      const created = await this.messages.bulkCreate(rows.slice(start, start + INSERT_CHUNK) as never[], {
        ignoreDuplicates: true,
        returning: ['id'],
      });
      inserted += created.filter((row) => row.id !== null && row.id !== undefined).length;
    }
    return inserted;
  }

  listDeliverableMessages(campaignId: string, now: Date, limit: number): Promise<NotificationMessageModel[]> {
    return this.messages.findAll({
      where: { campaignId, status: 'pending', scheduledAt: { [Op.lte]: now } } as WhereOptions,
      order: [
        ['scheduledAt', 'ASC'],
        ['id', 'ASC'],
      ],
      limit,
    });
  }

  countUndelivered(campaignId: string): Promise<number> {
    return this.messages.count({ where: { campaignId, status: { [Op.in]: ['pending', 'sending'] } } as WhereOptions });
  }

  async cancelPendingMessages(campaignId: string, now: Date): Promise<number> {
    const [affected] = await this.messages.update({ status: 'cancelled', cancelledAt: now, updatedAtValue: now } as never, {
      where: { campaignId, status: 'pending' } as WhereOptions,
    });
    return affected;
  }

  async messageStats(campaignId: string): Promise<CampaignMessageStat[]> {
    const sequelize = this.messages.sequelize;
    if (!sequelize) return [];
    const table = `${atlasSchemaFor('notification_messages')}.notification_messages`;
    const rows = await sequelize.query<{ channel: string; status: string; count: string; read: string }>(
      `SELECT channel, status, COUNT(*)::text AS count, COUNT(read_at)::text AS read
         FROM ${table} WHERE campaign_id = :campaignId GROUP BY channel, status`,
      { replacements: { campaignId }, type: QueryTypes.SELECT },
    );
    return rows.map((row) => ({ channel: row.channel, status: row.status, count: Number(row.count), read: Number(row.read) }));
  }

  createSegment(values: Record<string, unknown>): Promise<NotificationAudienceSegmentModel> {
    const now = new Date();
    return this.segments.create({ ...values, createdAtValue: now, updatedAtValue: now } as never);
  }

  findSegment(tenantId: string, segmentId: string): Promise<NotificationAudienceSegmentModel | null> {
    return this.segments.findOne({ where: { tenantId, id: segmentId } });
  }

  listSegments(tenantId: string, status: string): Promise<NotificationAudienceSegmentModel[]> {
    return this.segments.findAll({ where: { tenantId, status }, order: [['name', 'ASC']] });
  }

  async saveSegment(segment: NotificationAudienceSegmentModel, patch: Record<string, unknown>): Promise<NotificationAudienceSegmentModel> {
    segment.set({ ...patch, updatedAtValue: new Date() });
    return segment.save();
  }
}
