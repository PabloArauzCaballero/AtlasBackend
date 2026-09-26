/**
 * @file Ejecutor de campañas: arranca las que vencen, genera sus avisos por tandas, los entrega a la
 *   cadencia pedida y cierra las que terminaron.
 * @business Programar a las 9:00 significa que a las 9:00 empieza a llegar, sin nadie delante; y una
 *   campaña con fecha de fin deja de enviar (y de mostrarse) cuando termina.
 * @system Lo llama el planificador de trabajos (job `run_notification_campaigns`) por tenant. Todo el
 *   estado vive en la base —cursor de audiencia, avisos `pending`, `scheduled_at`— así que un reinicio a
 *   mitad de campaña se retoma en el siguiente tick sin duplicar: arrancar es un UPDATE condicional y
 *   los avisos tienen índice único por (campaña, destinatario, canal).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from '../../../common/utils/concurrency.util.js';
import type { NotificationCampaignModel } from '../../../database/models/index.js';
import {
  type AudienceDefinition,
  CAMPAIGN_AUDIENCE_PORT,
  type CampaignAudiencePort,
} from '../../../platform/contracts/campaign-audience.js';
import { NotificationOrchestratorService } from '../notification-orchestrator.service.js';
import { buildCampaignMessageRows } from './notification-campaign-messages.js';
import { NotificationCampaignsRepository } from './notification-campaigns.repository.js';

export type CampaignTickResult = { started: number; materialized: number; delivered: number; failed: number; completed: number };

/** Destinatarios por tanda de materialización. Acota la memoria y el tamaño de cada INSERT. */
export const MATERIALIZE_BATCH = 2_000;
/** Techo de avisos entregados por campaña en un tick, sea cual sea la cadencia pedida. */
export const DELIVERY_BATCH = 500;
const DELIVERY_CONCURRENCY = 8;

@Injectable()
export class NotificationCampaignRunnerService {
  private readonly logger = new Logger(NotificationCampaignRunnerService.name);

  constructor(
    private readonly repository: NotificationCampaignsRepository,
    private readonly orchestrator: NotificationOrchestratorService,
    @Inject(CAMPAIGN_AUDIENCE_PORT) private readonly audience: CampaignAudiencePort,
  ) {}

  async tick(tenantId: string, now = new Date()): Promise<CampaignTickResult> {
    const result: CampaignTickResult = { started: 0, materialized: 0, delivered: 0, failed: 0, completed: 0 };
    for (const campaign of await this.repository.listDueToStart(tenantId, now, 10)) {
      if (await this.repository.transition(String(campaign.id), ['scheduled'], { status: 'running', startedAt: now })) result.started += 1;
    }
    for (const campaign of await this.repository.listRunning(tenantId, 20)) {
      try {
        await this.advance(campaign, now, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Campaña ${String(campaign.id)} falló: ${message}`);
        await this.repository.transition(String(campaign.id), ['running'], {
          status: 'failed',
          finishedAt: now,
          lastError: message.slice(0, 400),
        });
      }
    }
    return result;
  }

  private async advance(campaign: NotificationCampaignModel, now: Date, result: CampaignTickResult): Promise<void> {
    const id = String(campaign.id);
    if (campaign.endsAt && campaign.endsAt <= now) {
      await this.repository.cancelPendingMessages(id, now);
      if (await this.repository.transition(id, ['running'], { status: 'completed', finishedAt: now })) result.completed += 1;
      return;
    }
    if (!campaign.materializedAt) result.materialized += await this.materialize(campaign, now);
    await this.deliver(campaign, now, result);
    if (campaign.materializedAt && (await this.repository.countUndelivered(id)) === 0) {
      if (await this.repository.transition(id, ['running'], { status: 'completed', finishedAt: now })) result.completed += 1;
    }
  }

  /** Genera los avisos de la siguiente tanda de la audiencia y avanza el cursor. */
  private async materialize(campaign: NotificationCampaignModel, now: Date): Promise<number> {
    const remaining = campaign.maxRecipients ? campaign.maxRecipients - campaign.targetedCount : MATERIALIZE_BATCH;
    const limit = Math.max(0, Math.min(MATERIALIZE_BATCH, remaining));
    const members =
      limit === 0
        ? []
        : await this.audience.listMembers(
            campaign.tenantId,
            campaign.audienceDefinitionJson as unknown as AudienceDefinition,
            { requireMarketingConsent: campaign.purpose === 'marketing' },
            { afterCustomerId: campaign.audienceCursor, limit },
          );
    const inserted = await this.repository.insertCampaignMessages(buildCampaignMessageRows(campaign, members, campaign.targetedCount, now));
    const done = members.length < limit || limit === 0;
    await this.repository.saveCampaign(campaign, {
      audienceCursor: members.length > 0 ? members[members.length - 1].customerId : campaign.audienceCursor,
      targetedCount: campaign.targetedCount + members.length,
      createdCount: campaign.createdCount + inserted,
      ...(done ? { materializedAt: now } : {}),
    });
    return members.length;
  }

  private async deliver(campaign: NotificationCampaignModel, now: Date, result: CampaignTickResult): Promise<void> {
    const due = await this.repository.listDeliverableMessages(String(campaign.id), now, DELIVERY_BATCH);
    await mapWithConcurrency(due, DELIVERY_CONCURRENCY, async (message) => {
      try {
        await this.orchestrator.deliverMessage(message);
        result.delivered += 1;
      } catch (error) {
        result.failed += 1;
        this.logger.warn(
          `Aviso ${String(message.id)} de la campaña ${String(campaign.id)} no salió: ${error instanceof Error ? error.message : error}`,
        );
      }
    });
  }
}
