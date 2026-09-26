/**
 * @file Mapper: transforma campañas y segmentos a contratos de transporte.
 * @business Lo que ve quien opera: estado, ventana, audiencia y cómo le fue a cada canal.
 * @system Las métricas se derivan de los mensajes agrupados por canal y estado; no hay contadores
 *   duplicados que puedan desincronizarse de lo que realmente se entregó.
 */
import type { NotificationAudienceSegmentModel, NotificationCampaignModel } from '../../../database/models/index.js';
import type { CampaignMessageStat } from './notification-campaigns.repository.js';

const DELIVERED = new Set(['sent', 'delivered', 'read']);

export type CampaignChannelMetrics = {
  channel: string;
  total: number;
  pending: number;
  delivered: number;
  failed: number;
  cancelled: number;
  read: number;
};

export function summarizeStats(stats: readonly CampaignMessageStat[]) {
  const byChannel = new Map<string, CampaignChannelMetrics>();
  for (const stat of stats) {
    const entry = byChannel.get(stat.channel) ?? {
      channel: stat.channel,
      total: 0,
      pending: 0,
      delivered: 0,
      failed: 0,
      cancelled: 0,
      read: 0,
    };
    entry.total += stat.count;
    entry.read += stat.read;
    if (DELIVERED.has(stat.status)) entry.delivered += stat.count;
    else if (stat.status === 'failed') entry.failed += stat.count;
    else if (stat.status === 'cancelled') entry.cancelled += stat.count;
    else entry.pending += stat.count;
    byChannel.set(stat.channel, entry);
  }
  const channels = [...byChannel.values()].sort((a, b) => a.channel.localeCompare(b.channel));
  const totals = channels.reduce(
    (acc, entry) => ({
      total: acc.total + entry.total,
      pending: acc.pending + entry.pending,
      delivered: acc.delivered + entry.delivered,
      failed: acc.failed + entry.failed,
      cancelled: acc.cancelled + entry.cancelled,
      read: acc.read + entry.read,
    }),
    { total: 0, pending: 0, delivered: 0, failed: 0, cancelled: 0, read: 0 },
  );
  return { totals, channels };
}

export function mapCampaign(campaign: NotificationCampaignModel, stats?: readonly CampaignMessageStat[]): Record<string, unknown> {
  return {
    id: String(campaign.id),
    campaignUuid: campaign.campaignUuid,
    name: campaign.name,
    purpose: campaign.purpose,
    status: campaign.status,
    title: campaign.title,
    body: campaign.body,
    category: campaign.category,
    icon: campaign.icon,
    deepLink: campaign.deepLink,
    channels: campaign.channels,
    audienceSegmentId: campaign.audienceSegmentId === null ? null : String(campaign.audienceSegmentId),
    audience: campaign.audienceDefinitionJson,
    audienceEstimate: campaign.audienceEstimateJson,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    timezone: campaign.timezone,
    ratePerMinute: campaign.ratePerMinute,
    maxRecipients: campaign.maxRecipients,
    targetedCount: campaign.targetedCount,
    createdCount: campaign.createdCount,
    materializedAt: campaign.materializedAt,
    createdBy: campaign.createdBy,
    scheduledBy: campaign.scheduledBy,
    scheduledAt: campaign.scheduledAt,
    startedAt: campaign.startedAt,
    pausedAt: campaign.pausedAt,
    finishedAt: campaign.finishedAt,
    cancelledAt: campaign.cancelledAt,
    cancelReason: campaign.cancelReason,
    lastError: campaign.lastError,
    createdAt: campaign.createdAtValue,
    updatedAt: campaign.updatedAtValue,
    ...(stats ? { metrics: summarizeStats(stats) } : {}),
  };
}

export function mapSegment(segment: NotificationAudienceSegmentModel): Record<string, unknown> {
  return {
    id: String(segment.id),
    name: segment.name,
    description: segment.description,
    definition: segment.definitionJson,
    lastEstimate: segment.lastEstimateJson,
    lastEstimatedAt: segment.lastEstimatedAt,
    status: segment.status,
    createdBy: segment.createdBy,
    createdAt: segment.createdAtValue,
    updatedAt: segment.updatedAtValue,
  };
}
