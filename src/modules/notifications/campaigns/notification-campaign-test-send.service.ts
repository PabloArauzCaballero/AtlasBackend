/**
 * @file Envío de prueba de una campaña a un único cliente.
 * @business Antes de mandar a miles, quien opera se lo manda a sí mismo (a su cuenta de cliente de
 *   prueba) y comprueba en el teléfono el título, el texto y a dónde lleva tocarlo.
 * @system Genera los mismos avisos que la campaña real, sin `campaign_id` (no cuentan en sus métricas)
 *   y con correlación `campaign-test:`; los entrega en el acto y devuelve cómo quedó cada canal.
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { NotificationOrchestratorService } from '../notification-orchestrator.service.js';
import { NotificationsRepository } from '../notifications.repository.js';
import { NotificationCampaignService } from './notification-campaign.service.js';
import { buildCampaignMessageRows, testCorrelationId } from './notification-campaign-messages.js';
import { NotificationCampaignsRepository } from './notification-campaigns.repository.js';
import type { TestSendCampaignDto } from './notification-campaigns.schemas.js';

@Injectable()
export class NotificationCampaignTestSendService {
  constructor(
    private readonly campaigns: NotificationCampaignService,
    private readonly repository: NotificationCampaignsRepository,
    private readonly notifications: NotificationsRepository,
    private readonly orchestrator: NotificationOrchestratorService,
  ) {}

  async send(tenantId: string, campaignId: string, dto: TestSendCampaignDto) {
    const campaign = await this.campaigns.load(tenantId, campaignId);
    const now = new Date();
    const member = { customerId: dto.customerId, hasPushDevice: true, hasVerifiedEmail: true };
    const rows = buildCampaignMessageRows(campaign, [member], 0, now, testCorrelationId(campaign.campaignUuid)).map((row) => ({
      ...row,
      scheduledAt: now,
      expiresAt: null,
      title: `[PRUEBA] ${campaign.title}`.slice(0, 200),
    }));
    if (rows.length === 0) throw new UnprocessableEntityException('NOTIFICATION_CAMPAIGN_NO_CHANNELS');
    await this.repository.insertCampaignMessages(rows);
    const created = await this.notifications.listMessages(tenantId, {
      page: 1,
      limit: rows.length,
      recipientType: 'customer',
      recipientId: dto.customerId,
      correlationId: testCorrelationId(campaign.campaignUuid),
      status: 'pending',
    } as never);
    if (created.rows.length === 0) throw new NotFoundException('NOTIFICATION_CAMPAIGN_TEST_NOT_CREATED');
    const results = [];
    for (const message of created.rows) {
      await this.orchestrator.deliverMessage(message).catch(() => undefined);
      const after = await this.notifications.getMessage(tenantId, String(message.id));
      const deliveries = await this.notifications.listDeliveries(tenantId, String(message.id)).catch(() => []);
      const last = deliveries[deliveries.length - 1];
      results.push({
        channel: after.channel,
        status: after.status,
        messageId: String(after.id),
        errorCode: last?.errorCode ?? null,
        errorMessage: last?.errorMessage ?? null,
      });
    }
    return { customerId: dto.customerId, results };
  }
}
