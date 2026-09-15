/**
 * @file Construcción de los avisos que genera una campaña, uno por destinatario y canal.
 * @business Cada persona recibe el aviso por los canales que la campaña eligió Y que puede recibir:
 *   in-app siempre, push si tiene la app con avisos activos, correo si tiene uno verificado.
 * @system Funciones puras. El escalonado de `scheduled_at` es lo que impone la cadencia por minuto:
 *   el runner sólo entrega lo que ya «venció», así que 10 000 avisos a 600/min tardan ~17 minutos.
 */
import type { NotificationCampaignModel } from '../../../database/models/index.js';
import type { AudienceMember } from '../../../platform/contracts/campaign-audience.js';

export function campaignCorrelationId(campaignUuid: string): string {
  return `campaign:${campaignUuid}`;
}

export function testCorrelationId(campaignUuid: string): string {
  return `campaign-test:${campaignUuid}`;
}

/** Los canales que aplican a UNA persona: los de la campaña que esa persona puede recibir. */
export function channelsForMember(campaignChannels: readonly string[], member: AudienceMember): string[] {
  return campaignChannels.filter(
    (channel) => channel === 'in_app' || (channel === 'push' && member.hasPushDevice) || (channel === 'email' && member.hasVerifiedEmail),
  );
}

/** Qué viaja en el `data` del push y en el payload del mensaje: la campaña y a dónde lleva tocarlo. */
export function campaignPayload(campaign: Pick<NotificationCampaignModel, 'campaignUuid' | 'deepLink'>): Record<string, unknown> {
  const pushData: Record<string, string> = { campaignId: campaign.campaignUuid };
  if (campaign.deepLink) pushData.deepLink = campaign.deepLink;
  return { campaignId: campaign.campaignUuid, deepLink: campaign.deepLink, pushData, visible: true };
}

export function scheduledSlot(startsAt: Date, ordinal: number, ratePerMinute: number): Date {
  return new Date(startsAt.getTime() + Math.floor(ordinal / Math.max(1, ratePerMinute)) * 60_000);
}

export function buildCampaignMessageRows(
  campaign: NotificationCampaignModel,
  members: readonly AudienceMember[],
  firstOrdinal: number,
  now: Date,
  correlationId = campaignCorrelationId(campaign.campaignUuid),
): Array<Record<string, unknown>> {
  const startsAt = campaign.startsAt && campaign.startsAt > now ? campaign.startsAt : now;
  const payloadJson = campaignPayload(campaign);
  return members.flatMap((member, index) =>
    channelsForMember(campaign.channels, member).map((channel) => ({
      tenantId: campaign.tenantId,
      outboxEventId: null,
      recipientType: 'customer',
      recipientId: member.customerId,
      channel,
      templateCode: null,
      subject: channel === 'email' ? campaign.title : null,
      title: campaign.title,
      body: campaign.body,
      payloadJson,
      deliveryTargetsJson: [],
      status: 'pending',
      priority: 50,
      category: campaign.category,
      icon: campaign.icon,
      scheduledAt: scheduledSlot(startsAt, firstOrdinal + index, campaign.ratePerMinute),
      queuedAt: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
      cancelledAt: null,
      idempotencyKey: null,
      correlationId,
      causationId: null,
      campaignId: correlationId.startsWith('campaign-test:') ? null : campaign.id,
      expiresAt: campaign.endsAt,
      createdAtValue: now,
      updatedAtValue: now,
    })),
  );
}
