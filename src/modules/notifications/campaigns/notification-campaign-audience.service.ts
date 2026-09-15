/**
 * @file Audiencia de campañas: estimación y segmentos guardados.
 * @business Antes de programar, operaciones ve cuántas personas alcanza el segmento y cuántas tienen
 *   la app con avisos activos o un correo verificado. Un segmento se guarda para reutilizarlo.
 * @system Resuelve la definición (segmento guardado o reglas sueltas) y la entrega al puerto de
 *   audiencia que implementa Clientes. `marketing` exige consentimiento; `operational` no.
 */
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import {
  type AudienceDefinition,
  type AudienceEstimate,
  CAMPAIGN_AUDIENCE_PORT,
  type CampaignAudiencePort,
} from '../../../platform/contracts/campaign-audience.js';
import { mapSegment } from './notification-campaigns.mapper.js';
import { NotificationCampaignsRepository } from './notification-campaigns.repository.js';
import type { CreateSegmentDto, EstimateAudienceDto, UpdateSegmentDto } from './notification-campaigns.schemas.js';

const EVERYONE: AudienceDefinition = Object.freeze({ match: 'all', rules: [] });

@Injectable()
export class NotificationCampaignAudienceService {
  constructor(
    private readonly repository: NotificationCampaignsRepository,
    @Inject(CAMPAIGN_AUDIENCE_PORT) private readonly audience: CampaignAudiencePort,
  ) {}

  /** La definición efectiva: la del segmento si se indicó uno, si no las reglas sueltas, si no «todos». */
  async resolveDefinition(
    tenantId: string,
    input: { audienceSegmentId?: string | null; audience?: AudienceDefinition },
  ): Promise<AudienceDefinition> {
    if (input.audienceSegmentId) {
      const segment = await this.repository.findSegment(tenantId, input.audienceSegmentId);
      if (!segment || segment.status !== 'active') throw new NotFoundException('NOTIFICATION_AUDIENCE_SEGMENT_NOT_FOUND');
      return segment.definitionJson as unknown as AudienceDefinition;
    }
    return input.audience ?? EVERYONE;
  }

  estimateDefinition(tenantId: string, definition: AudienceDefinition, purpose: string): Promise<AudienceEstimate> {
    return this.audience.estimate(tenantId, definition, { requireMarketingConsent: purpose === 'marketing' });
  }

  async estimate(tenantId: string, dto: EstimateAudienceDto) {
    const definition = await this.resolveDefinition(tenantId, dto);
    const estimate = await this.estimateDefinition(tenantId, definition, dto.purpose);
    return { definition, purpose: dto.purpose, requiresMarketingConsent: dto.purpose === 'marketing', ...estimate };
  }

  async listSegments(tenantId: string, status: string) {
    const rows = await this.repository.listSegments(tenantId, status);
    return { data: rows.map(mapSegment) };
  }

  async createSegment(tenantId: string, actorId: string, dto: CreateSegmentDto) {
    const estimate = await this.estimateDefinition(tenantId, dto.definition, 'marketing');
    try {
      const segment = await this.repository.createSegment({
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        definitionJson: dto.definition,
        lastEstimateJson: estimate,
        lastEstimatedAt: new Date(),
        status: 'active',
        createdBy: actorId,
      });
      return mapSegment(segment);
    } catch (error) {
      if (error instanceof UniqueConstraintError) throw new ConflictException('NOTIFICATION_AUDIENCE_SEGMENT_NAME_TAKEN');
      throw error;
    }
  }

  async updateSegment(tenantId: string, segmentId: string, dto: UpdateSegmentDto) {
    const segment = await this.repository.findSegment(tenantId, segmentId);
    if (!segment) throw new NotFoundException('NOTIFICATION_AUDIENCE_SEGMENT_NOT_FOUND');
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.definition !== undefined) {
      patch.definitionJson = dto.definition;
      patch.lastEstimateJson = await this.estimateDefinition(tenantId, dto.definition, 'marketing');
      patch.lastEstimatedAt = new Date();
    }
    try {
      return mapSegment(await this.repository.saveSegment(segment, patch));
    } catch (error) {
      if (error instanceof UniqueConstraintError) throw new ConflictException('NOTIFICATION_AUDIENCE_SEGMENT_NAME_TAKEN');
      throw error;
    }
  }
}
