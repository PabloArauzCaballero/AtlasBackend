/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions } from 'sequelize';
import {
  SystemDataEntityCatalogModel,
  SystemDataFieldCatalogModel,
  SystemEndpointCatalogModel,
  SystemEndpointDataEntityImpactModel,
  SystemEndpointFieldImpactModel,
  SystemEndpointToolRequirementModel,
  SystemCatalogReviewEventModel,
} from '../../database/models/index.js';
import { ReviewDecisionDto, SystemsReviewQueueDto } from './systems-ops.schemas.js';
import { buildReviewWhere } from './systems-repository-where.util.js';

@Injectable()
export class SystemsReviewRepository {
  constructor(
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel,
    @InjectModel(SystemDataEntityCatalogModel) private readonly dataEntityModel: typeof SystemDataEntityCatalogModel,
    @InjectModel(SystemEndpointDataEntityImpactModel) private readonly dataImpactModel: typeof SystemEndpointDataEntityImpactModel,
    @InjectModel(SystemEndpointFieldImpactModel) private readonly fieldImpactModel: typeof SystemEndpointFieldImpactModel,
    @InjectModel(SystemDataFieldCatalogModel) private readonly dataFieldModel: typeof SystemDataFieldCatalogModel,
    @InjectModel(SystemEndpointToolRequirementModel) private readonly endpointToolModel: typeof SystemEndpointToolRequirementModel,
    @InjectModel(SystemCatalogReviewEventModel) private readonly reviewEventModel: typeof SystemCatalogReviewEventModel,
  ) {}

  async listReviewQueue(query: SystemsReviewQueueDto) {
    const limit = query.limit;
    const offset = (query.page - 1) * query.limit;
    const include = (kind: string) => query.type === 'all' || query.type === kind;
    const [endpoints, dataEntities, dataImpacts, fieldImpacts, dataColumns, toolRequirements] = await Promise.all([
      include('endpoints')
        ? this.endpointModel.findAndCountAll({
            where: buildReviewWhere(query),
            order: [['updatedAtValue', 'DESC']],
            limit,
            offset,
          } as FindAndCountOptions)
        : Promise.resolve({ rows: [], count: 0 }),
      include('data_entities')
        ? this.dataEntityModel.findAndCountAll({
            where: buildReviewWhere(query),
            order: [['updatedAtValue', 'DESC']],
            limit,
            offset,
          } as FindAndCountOptions)
        : Promise.resolve({ rows: [], count: 0 }),
      include('data_impacts')
        ? this.dataImpactModel.findAndCountAll({
            where: { reviewStatus: query.reviewStatus },
            order: [['updatedAtValue', 'DESC']],
            limit,
            offset,
          } as FindAndCountOptions)
        : Promise.resolve({ rows: [], count: 0 }),
      include('field_impacts')
        ? this.fieldImpactModel.findAndCountAll({
            where: { reviewStatus: query.reviewStatus },
            order: [['id', 'DESC']],
            limit,
            offset,
          } as FindAndCountOptions)
        : Promise.resolve({ rows: [], count: 0 }),
      include('data_column_impacts')
        ? this.dataFieldModel.findAndCountAll({
            where: { reviewStatus: query.reviewStatus },
            order: [['updatedAtValue', 'DESC']],
            limit,
            offset,
          } as FindAndCountOptions)
        : Promise.resolve({ rows: [], count: 0 }),
      include('tool_requirements')
        ? this.endpointToolModel.findAndCountAll({
            where: { reviewStatus: query.reviewStatus },
            order: [['updatedAtValue', 'DESC']],
            limit,
            offset,
          } as FindAndCountOptions)
        : Promise.resolve({ rows: [], count: 0 }),
    ]);
    return { endpoints, dataEntities, dataImpacts, fieldImpacts, dataColumns, toolRequirements };
  }

  async updateEndpointReview(
    endpointId: string,
    decision: ReviewDecisionDto,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemEndpointCatalogModel | null> {
    const row = await this.endpointModel.findByPk(endpointId);
    if (!row) return null;
    const previousStatus = row.reviewStatus;
    const previousConfidence = row.confidenceLevel;
    row.reviewStatus = decision.reviewStatus;
    if (decision.confidenceLevel) row.confidenceLevel = decision.confidenceLevel;
    row.updatedBy = actorId;
    row.updatedAtValue = new Date();
    const saved = await row.save();
    await this.recordReview({
      targetType: 'endpoint',
      targetId: endpointId,
      previousStatus,
      previousConfidence,
      decision,
      actorId,
      actorRole,
      tenantId,
    });
    return saved;
  }

  async updateDataEntityReview(
    entityId: string,
    decision: ReviewDecisionDto,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemDataEntityCatalogModel | null> {
    const row = await this.dataEntityModel.findByPk(entityId);
    if (!row) return null;
    const previousStatus = row.reviewStatus;
    const previousConfidence = row.confidenceLevel;
    row.reviewStatus = decision.reviewStatus;
    if (decision.confidenceLevel) row.confidenceLevel = decision.confidenceLevel;
    row.updatedAtValue = new Date();
    const saved = await row.save();
    await this.recordReview({
      targetType: 'data_entity',
      targetId: entityId,
      previousStatus,
      previousConfidence,
      decision,
      actorId,
      actorRole,
      tenantId,
    });
    return saved;
  }

  async updateDataImpactReview(
    impactId: string,
    decision: ReviewDecisionDto,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemEndpointDataEntityImpactModel | null> {
    const row = await this.dataImpactModel.findByPk(impactId);
    if (!row) return null;
    const previousStatus = row.reviewStatus;
    const previousConfidence = row.confidenceLevel;
    row.reviewStatus = decision.reviewStatus;
    if (decision.confidenceLevel) row.confidenceLevel = decision.confidenceLevel;
    if (decision.notes) row.notes = decision.notes;
    row.updatedAtValue = new Date();
    const saved = await row.save();
    await this.recordReview({
      targetType: 'data_impact',
      targetId: impactId,
      previousStatus,
      previousConfidence,
      decision,
      actorId,
      actorRole,
      tenantId,
    });
    return saved;
  }

  async updateFieldImpactReview(
    impactId: string,
    decision: ReviewDecisionDto,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemEndpointFieldImpactModel | null> {
    const row = await this.fieldImpactModel.findByPk(impactId);
    if (!row) return null;
    const previousStatus = row.reviewStatus;
    const previousConfidence = row.confidenceLevel;
    row.reviewStatus = decision.reviewStatus;
    if (decision.confidenceLevel) row.confidenceLevel = decision.confidenceLevel;
    if (decision.notes) row.notes = decision.notes;
    const saved = await row.save();
    await this.recordReview({
      targetType: 'field_impact',
      targetId: impactId,
      previousStatus,
      previousConfidence,
      decision,
      actorId,
      actorRole,
      tenantId,
    });
    return saved;
  }

  async updateDataColumnReview(
    columnId: string,
    decision: ReviewDecisionDto,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemDataFieldCatalogModel | null> {
    const row = await this.dataFieldModel.findByPk(columnId);
    if (!row) return null;
    const previousStatus = row.reviewStatus;
    const previousConfidence = row.confidenceLevel;
    row.reviewStatus = decision.reviewStatus;
    if (decision.confidenceLevel) row.confidenceLevel = decision.confidenceLevel;
    if (decision.notes) row.operationalNotes = decision.notes;
    row.detectedFrom = 'manual';
    row.manuallyEditedAt = new Date();
    row.updatedAtValue = new Date();
    const saved = await row.save();
    await this.recordReview({
      targetType: 'data_column',
      targetId: columnId,
      previousStatus,
      previousConfidence,
      decision,
      actorId,
      actorRole,
      tenantId,
    });
    return saved;
  }

  async updateToolRequirementReview(
    requirementId: string,
    decision: ReviewDecisionDto,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemEndpointToolRequirementModel | null> {
    const row = await this.endpointToolModel.findByPk(requirementId);
    if (!row) return null;
    const previousStatus = row.reviewStatus;
    const previousConfidence = row.confidenceLevel;
    row.reviewStatus = decision.reviewStatus;
    if (decision.confidenceLevel) row.confidenceLevel = decision.confidenceLevel;
    if (decision.notes) row.notes = decision.notes;
    row.updatedAtValue = new Date();
    const saved = await row.save();
    await this.recordReview({
      targetType: 'tool_requirement',
      targetId: requirementId,
      previousStatus,
      previousConfidence,
      decision,
      actorId,
      actorRole,
      tenantId,
    });
    return saved;
  }

  /*
   * Argumentos con nombre: la llamada tenía ocho posiciones y cuatro eran `string | null`
   * seguidas —`previousStatus`, `previousConfidence`, `actorId`, `tenantId`—. Intercambiar dos
   * compilaba sin una queja y dejaba el evento de revisión atribuido a otro actor o a otro
   * tenant, que es exactamente lo que este registro existe para poder demostrar.
   */
  private async recordReview(entrada: {
    targetType: string;
    targetId: string;
    previousStatus: string | null;
    previousConfidence: string | null;
    decision: ReviewDecisionDto;
    actorId: string | null;
    actorRole: string;
    tenantId: string | null;
  }): Promise<void> {
    const { targetType, targetId, previousStatus, previousConfidence, decision, actorId, actorRole, tenantId } =
      entrada;
    await this.reviewEventModel.create({
      tenantId,
      targetType,
      targetId,
      previousStatus,
      newStatus: decision.reviewStatus,
      previousConfidence,
      newConfidence: decision.confidenceLevel ?? previousConfidence,
      notes: decision.notes ?? null,
      actorId,
      actorRole,
      createdAtValue: new Date(),
    } as never);
  }
}
