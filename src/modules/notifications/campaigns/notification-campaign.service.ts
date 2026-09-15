/**
 * @file Ciclo de vida de una campaña de notificación.
 * @business Borrador → programada → en curso → terminada, con pausa, reanudación y cancelación. Nada
 *   se envía hasta programar, y programar exige una audiencia que no esté vacía y una ventana válida.
 * @system Las transiciones van por `repository.transition` (condicional por estado). Cancelar anula
 *   en bloque los avisos que aún no salieron; los ya entregados no se tocan.
 */
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UniqueConstraintError } from 'sequelize';
import type { NotificationCampaignModel } from '../../../database/models/index.js';
import type { AudienceDefinition } from '../../../platform/contracts/campaign-audience.js';
import { mapMessage } from '../notifications.mapper.js';
import { NotificationsRepository } from '../notifications.repository.js';
import { NotificationCampaignAudienceService } from './notification-campaign-audience.service.js';
import { campaignCorrelationId } from './notification-campaign-messages.js';
import { mapCampaign } from './notification-campaigns.mapper.js';
import { NotificationCampaignsRepository } from './notification-campaigns.repository.js';
import type { CancelCampaignDto, CreateCampaignDto, ListCampaignsQueryDto, UpdateCampaignDto } from './notification-campaigns.schemas.js';

/** Tolerancia para «empezar ahora»: el reloj del navegador y el del servidor no coinciden al segundo. */
const START_GRACE_MS = 5 * 60_000;
const EDITABLE = ['draft', 'scheduled'] as const;
const CANCELLABLE = ['draft', 'scheduled', 'running', 'paused'] as const;

@Injectable()
export class NotificationCampaignService {
  constructor(
    private readonly repository: NotificationCampaignsRepository,
    private readonly audience: NotificationCampaignAudienceService,
    private readonly notifications: NotificationsRepository,
  ) {}

  async list(tenantId: string, query: ListCampaignsQueryDto) {
    const result = await this.repository.listCampaigns(tenantId, query);
    return {
      data: result.rows.map((row) => mapCampaign(row)),
      pagination: { page: query.page, limit: query.limit, total: result.count, totalPages: Math.ceil(result.count / query.limit) },
    };
  }

  async get(tenantId: string, campaignId: string) {
    const campaign = await this.load(tenantId, campaignId);
    return mapCampaign(campaign, await this.repository.messageStats(String(campaign.id)));
  }

  async listMessages(tenantId: string, campaignId: string, query: { page: number; limit: number; status?: string; channel?: string }) {
    const campaign = await this.load(tenantId, campaignId);
    const result = await this.notifications.listMessages(tenantId, {
      ...query,
      correlationId: campaignCorrelationId(campaign.campaignUuid),
    } as never);
    return {
      data: result.rows.map(mapMessage),
      pagination: { page: query.page, limit: query.limit, total: result.count, totalPages: Math.ceil(result.count / query.limit) },
    };
  }

  async create(tenantId: string, actorId: string, dto: CreateCampaignDto, idempotencyKey: string) {
    const existing = await this.repository.findCampaignByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) return mapCampaign(existing);
    const definition = await this.audience.resolveDefinition(tenantId, dto);
    try {
      const campaign = await this.repository.createCampaign({
        tenantId,
        campaignUuid: randomUUID(),
        name: dto.name,
        purpose: dto.purpose,
        status: 'draft',
        title: dto.title,
        body: dto.body,
        category: dto.category,
        icon: dto.icon ?? null,
        deepLink: dto.deepLink ?? null,
        channels: dto.channels,
        audienceSegmentId: dto.audienceSegmentId ?? null,
        audienceDefinitionJson: definition,
        startsAt: dto.startsAt ?? null,
        endsAt: dto.endsAt ?? null,
        timezone: 'America/La_Paz',
        ratePerMinute: dto.ratePerMinute,
        maxRecipients: dto.maxRecipients ?? null,
        targetedCount: 0,
        createdCount: 0,
        createdBy: actorId,
        idempotencyKey,
      });
      return mapCampaign(campaign);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        const winner = await this.repository.findCampaignByIdempotencyKey(tenantId, idempotencyKey);
        if (winner) return mapCampaign(winner);
      }
      throw error;
    }
  }

  async update(tenantId: string, campaignId: string, dto: UpdateCampaignDto) {
    const campaign = await this.load(tenantId, campaignId);
    this.assertStatus(campaign, EDITABLE, 'editar');
    const patch: Record<string, unknown> = {};
    for (const key of [
      'name',
      'purpose',
      'title',
      'body',
      'category',
      'icon',
      'deepLink',
      'channels',
      'startsAt',
      'endsAt',
      'ratePerMinute',
      'maxRecipients',
    ] as const) {
      if (dto[key] !== undefined) patch[key] = dto[key];
    }
    if (dto.audienceSegmentId !== undefined || dto.audience !== undefined) {
      patch.audienceSegmentId = dto.audienceSegmentId ?? null;
      patch.audienceDefinitionJson = await this.audience.resolveDefinition(tenantId, dto);
    }
    const startsAt = (patch.startsAt as Date | null | undefined) ?? campaign.startsAt;
    const endsAt = (patch.endsAt as Date | null | undefined) ?? campaign.endsAt;
    if (startsAt && endsAt && endsAt <= startsAt) throw new UnprocessableEntityException('NOTIFICATION_CAMPAIGN_WINDOW_INVALID');
    // Editar una campaña programada la devuelve a borrador: lo que se aprobó al programar ya no es lo que hay.
    if (campaign.status === 'scheduled')
      Object.assign(patch, { status: 'draft', scheduledAt: null, scheduledBy: null, audienceEstimateJson: null });
    return mapCampaign(await this.repository.saveCampaign(campaign, patch));
  }

  async schedule(tenantId: string, campaignId: string, actorId: string) {
    const campaign = await this.load(tenantId, campaignId);
    this.assertStatus(campaign, ['draft'], 'programar');
    const now = new Date();
    const startsAt = campaign.startsAt ?? now;
    if (startsAt.getTime() < now.getTime() - START_GRACE_MS) throw new UnprocessableEntityException('NOTIFICATION_CAMPAIGN_START_IN_PAST');
    if (campaign.endsAt && campaign.endsAt.getTime() <= Math.max(startsAt.getTime(), now.getTime())) {
      throw new UnprocessableEntityException('NOTIFICATION_CAMPAIGN_ENDS_BEFORE_START');
    }
    const definition = campaign.audienceDefinitionJson as unknown as AudienceDefinition;
    const estimate = await this.audience.estimateDefinition(tenantId, definition, campaign.purpose);
    if (estimate.total === 0) throw new UnprocessableEntityException('NOTIFICATION_CAMPAIGN_AUDIENCE_EMPTY');
    const moved = await this.repository.transition(String(campaign.id), ['draft'], {
      status: 'scheduled',
      startsAt,
      audienceEstimateJson: estimate,
      scheduledAt: now,
      scheduledBy: actorId,
      lastError: null,
    });
    if (!moved) throw new ConflictException('NOTIFICATION_CAMPAIGN_STATUS_CHANGED');
    return this.get(tenantId, campaignId);
  }

  unschedule(tenantId: string, campaignId: string) {
    return this.move(tenantId, campaignId, ['scheduled'], { status: 'draft', scheduledAt: null, scheduledBy: null }, 'desprogramar');
  }

  pause(tenantId: string, campaignId: string) {
    return this.move(tenantId, campaignId, ['running'], { status: 'paused', pausedAt: new Date() }, 'pausar');
  }

  resume(tenantId: string, campaignId: string) {
    return this.move(tenantId, campaignId, ['paused'], { status: 'running', pausedAt: null }, 'reanudar');
  }

  async cancel(tenantId: string, campaignId: string, dto: CancelCampaignDto) {
    const campaign = await this.load(tenantId, campaignId);
    this.assertStatus(campaign, CANCELLABLE, 'cancelar');
    const now = new Date();
    const moved = await this.repository.transition(String(campaign.id), CANCELLABLE, {
      status: 'cancelled',
      cancelledAt: now,
      finishedAt: now,
      cancelReason: dto.reason,
    });
    if (!moved) throw new ConflictException('NOTIFICATION_CAMPAIGN_STATUS_CHANGED');
    await this.repository.cancelPendingMessages(String(campaign.id), now);
    return this.get(tenantId, campaignId);
  }

  async duplicate(tenantId: string, campaignId: string, actorId: string, idempotencyKey: string) {
    const source = await this.load(tenantId, campaignId);
    return this.create(
      tenantId,
      actorId,
      {
        name: `${source.name} (copia)`.slice(0, 140),
        purpose: source.purpose as 'marketing' | 'operational',
        title: source.title,
        body: source.body,
        category: source.category,
        icon: source.icon,
        deepLink: source.deepLink,
        channels: source.channels as CreateCampaignDto['channels'],
        audienceSegmentId: null,
        audience: source.audienceDefinitionJson as unknown as CreateCampaignDto['audience'],
        startsAt: null,
        endsAt: null,
        ratePerMinute: source.ratePerMinute,
        maxRecipients: source.maxRecipients,
      },
      idempotencyKey,
    );
  }

  async load(tenantId: string, campaignId: string): Promise<NotificationCampaignModel> {
    const campaign = await this.repository.findCampaign(tenantId, campaignId);
    if (!campaign) throw new NotFoundException('NOTIFICATION_CAMPAIGN_NOT_FOUND');
    return campaign;
  }

  private async move(tenantId: string, campaignId: string, from: readonly string[], patch: Record<string, unknown>, verb: string) {
    const campaign = await this.load(tenantId, campaignId);
    this.assertStatus(campaign, from, verb);
    if (!(await this.repository.transition(String(campaign.id), from, patch)))
      throw new ConflictException('NOTIFICATION_CAMPAIGN_STATUS_CHANGED');
    return this.get(tenantId, campaignId);
  }

  private assertStatus(campaign: NotificationCampaignModel, allowed: readonly string[], verb: string): void {
    if (!allowed.includes(campaign.status)) {
      throw new ConflictException(
        `NOTIFICATION_CAMPAIGN_INVALID_TRANSITION: no se puede ${verb} una campaña en estado ${campaign.status}.`,
      );
    }
  }
}
