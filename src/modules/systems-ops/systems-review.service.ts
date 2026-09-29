/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { mapDataEntity, mapDataField, mapDataImpact, mapEndpoint, mapFieldImpact, mapToolRequirement } from './systems-ops.mapper.js';
import { ReviewDecisionDto, SystemsReviewQueueDto } from './systems-ops.schemas.js';
import { SystemsReviewRepository } from './systems-review.repository.js';
import { actorId } from '../../common/utils/auth/actor.util.js';
import { buildPaginationMeta } from '../../common/utils/pagination/pagination.util.js';

@Injectable()
export class SystemsReviewService {
  constructor(private readonly reviewRepository: SystemsReviewRepository) {}

  /**
   * Cada familia lleva su `meta` (página, tamaño, total y páginas). Antes sólo traía `total`, y la
   * pantalla no podía pasar de la primera página: todo lo que excedía el tamaño de página era
   * inalcanzable. `total` se conserva para los clientes que ya lo leían.
   */
  async getReviewQueue(query: SystemsReviewQueueDto) {
    const result = await this.reviewRepository.listReviewQueue(query);
    const bucket = <R, T>(found: { rows: R[]; count: number }, map: (row: R) => T) => ({
      items: found.rows.map(map),
      total: found.count,
      meta: buildPaginationMeta(query, found.count),
    });
    return {
      endpoints: bucket(result.endpoints, mapEndpoint),
      dataEntities: bucket(result.dataEntities, mapDataEntity),
      dataEntityImpacts: bucket(result.dataImpacts, (row) => mapDataImpact(row)),
      fieldImpacts: bucket(result.fieldImpacts, (row) => mapFieldImpact(row)),
      dataColumnImpacts: bucket(result.dataColumns, mapDataField),
      toolRequirements: bucket(result.toolRequirements, (row) => mapToolRequirement(row)),
    };
  }

  async reviewEndpoint(endpointId: string, decision: ReviewDecisionDto, user: AuthenticatedUser) {
    const row = await this.reviewRepository.updateEndpointReview(endpointId, decision, actorId(user), user.role, user.tenantId ?? null);
    if (!row) throw new NotFoundException('SYSTEM_ENDPOINT_NOT_FOUND');
    return mapEndpoint(row);
  }

  async reviewDataEntity(entityId: string, decision: ReviewDecisionDto, user: AuthenticatedUser) {
    const row = await this.reviewRepository.updateDataEntityReview(entityId, decision, actorId(user), user.role, user.tenantId ?? null);
    if (!row) throw new NotFoundException('SYSTEM_DATA_ENTITY_NOT_FOUND');
    return mapDataEntity(row);
  }

  async reviewDataImpact(impactId: string, decision: ReviewDecisionDto, user: AuthenticatedUser) {
    const row = await this.reviewRepository.updateDataImpactReview(impactId, decision, actorId(user), user.role, user.tenantId ?? null);
    if (!row) throw new NotFoundException('SYSTEM_DATA_IMPACT_NOT_FOUND');
    return mapDataImpact(row);
  }

  async reviewFieldImpact(fieldImpactId: string, decision: ReviewDecisionDto, user: AuthenticatedUser) {
    const row = await this.reviewRepository.updateFieldImpactReview(
      fieldImpactId,
      decision,
      actorId(user),
      user.role,
      user.tenantId ?? null,
    );
    if (!row) throw new NotFoundException('SYSTEM_FIELD_IMPACT_NOT_FOUND');
    return mapFieldImpact(row);
  }

  async reviewDataColumn(columnId: string, decision: ReviewDecisionDto, user: AuthenticatedUser) {
    const row = await this.reviewRepository.updateDataColumnReview(columnId, decision, actorId(user), user.role, user.tenantId ?? null);
    if (!row) throw new NotFoundException('SYSTEM_DATA_COLUMN_NOT_FOUND');
    return mapDataField(row);
  }

  async reviewToolRequirement(requirementId: string, decision: ReviewDecisionDto, user: AuthenticatedUser) {
    const row = await this.reviewRepository.updateToolRequirementReview(
      requirementId,
      decision,
      actorId(user),
      user.role,
      user.tenantId ?? null,
    );
    if (!row) throw new NotFoundException('SYSTEM_TOOL_REQUIREMENT_NOT_FOUND');
    return mapToolRequirement(row);
  }
}
