import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { mapDataEntity, mapDataField, mapDataImpact, mapEndpoint, mapFieldImpact, mapToolRequirement } from './systems-ops.mapper.js';
import { ReviewDecisionDto, SystemsReviewQueueDto } from './systems-ops.schemas.js';
import { SystemsReviewRepository } from './systems-review.repository.js';
import { actorId } from './systems-actor.util.js';

@Injectable()
export class SystemsReviewService {
  constructor(private readonly reviewRepository: SystemsReviewRepository) {}

  async getReviewQueue(query: SystemsReviewQueueDto) {
    const result = await this.reviewRepository.listReviewQueue(query);
    return {
      endpoints: { items: result.endpoints.rows.map(mapEndpoint), total: result.endpoints.count },
      dataEntities: { items: result.dataEntities.rows.map(mapDataEntity), total: result.dataEntities.count },
      dataEntityImpacts: { items: result.dataImpacts.rows.map((row) => mapDataImpact(row)), total: result.dataImpacts.count },
      fieldImpacts: { items: result.fieldImpacts.rows.map((row) => mapFieldImpact(row)), total: result.fieldImpacts.count },
      dataColumnImpacts: { items: result.dataColumns.rows.map(mapDataField), total: result.dataColumns.count },
      toolRequirements: { items: result.toolRequirements.rows.map((row) => mapToolRequirement(row)), total: result.toolRequirements.count },
    };
  }

  async reviewEndpoint(endpointId: string, decision: ReviewDecisionDto, user: AuthenticatedUser) {
    const row = await this.reviewRepository.updateEndpointReview(endpointId, decision, actorId(user));
    if (!row) throw new NotFoundException('SYSTEM_ENDPOINT_NOT_FOUND');
    return mapEndpoint(row);
  }

  async reviewDataEntity(entityId: string, decision: ReviewDecisionDto) {
    const row = await this.reviewRepository.updateDataEntityReview(entityId, decision);
    if (!row) throw new NotFoundException('SYSTEM_DATA_ENTITY_NOT_FOUND');
    return mapDataEntity(row);
  }

  async reviewDataImpact(impactId: string, decision: ReviewDecisionDto) {
    const row = await this.reviewRepository.updateDataImpactReview(impactId, decision);
    if (!row) throw new NotFoundException('SYSTEM_DATA_IMPACT_NOT_FOUND');
    return mapDataImpact(row);
  }

  async reviewFieldImpact(fieldImpactId: string, decision: ReviewDecisionDto) {
    const row = await this.reviewRepository.updateFieldImpactReview(fieldImpactId, decision);
    if (!row) throw new NotFoundException('SYSTEM_FIELD_IMPACT_NOT_FOUND');
    return mapFieldImpact(row);
  }

  async reviewDataColumn(columnId: string, decision: ReviewDecisionDto) {
    const row = await this.reviewRepository.updateDataColumnReview(columnId, decision);
    if (!row) throw new NotFoundException('SYSTEM_DATA_COLUMN_NOT_FOUND');
    return mapDataField(row);
  }

  async reviewToolRequirement(requirementId: string, decision: ReviewDecisionDto) {
    const row = await this.reviewRepository.updateToolRequirementReview(requirementId, decision);
    if (!row) throw new NotFoundException('SYSTEM_TOOL_REQUIREMENT_NOT_FOUND');
    return mapToolRequirement(row);
  }
}
