import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CatalogManagementRepository } from '../catalog-management.repository.js';
import { CatalogIngestionDto, StagingDecisionBatchDto } from '../catalog-management.schemas.js';
import {
  actorPlatformUserId,
  assertInternal,
  auditBase,
  normalizeAlias,
  RequestContext,
  requireIdempotency,
} from './catalog-management.shared.js';

@Injectable()
export class CatalogIngestionService {
  constructor(
    private readonly repository: CatalogManagementRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async ingestCatalog(input: { body: CatalogIngestionDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const catalog = await this.repository.findCatalogByCode(input.body.catalogCode);
    if (!catalog) throw new NotFoundException('Catálogo no encontrado.');
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const sourceCode = input.body.sourceCode ?? `manual_${sha256Hex(input.body.sourceName).slice(0, 16)}`;
      let source = await this.repository.findSourceByCode(sourceCode, { transaction });
      source ??= await this.repository.createSource(
        { sourceCode, sourceName: input.body.sourceName, sourceType: input.body.sourceType, now },
        { transaction },
      );
      const job = await this.repository.createIngestionJob(
        {
          jobCode: `ing_${Date.now()}_${sha256Hex(input.body.catalogCode).slice(0, 8)}`,
          sourceType: input.body.sourceType,
          sourceName: input.body.sourceName,
          triggeredByType: input.currentUser.role,
          triggeredByPlatformUserId: actorPlatformUserId(input.currentUser),
          status: 'completed',
          summary: { catalogCode: input.body.catalogCode, itemsReceived: input.body.items.length, sourceId: String(source.id) },
          now,
        },
        { transaction },
      );
      for (const item of input.body.items) {
        await this.repository.createStagingItem(
          {
            catalogId: String(catalog.id),
            ingestionJobId: String(job.id),
            proposedItemCode: item.normalizedValue ?? null,
            proposedItemName: item.rawValue,
            proposedAttributes: {
              ...item.rawPayload,
              itemType: item.itemType,
              confidenceScore: item.confidenceScore ?? null,
              sourceId: String(source.id),
            },
            aiSuggested: item.aiSuggested,
            createdByType: input.currentUser.role,
            createdByPlatformUserId: actorPlatformUserId(input.currentUser),
            now,
          },
          { transaction },
        );
      }
      await this.repository.createAudit(
        {
          ...auditBase(input.context, input.currentUser),
          actionCode: 'catalog.ingestion.create',
          targetType: 'context_ingestion_job',
          targetId: String(job.id),
          payload: { catalogCode: input.body.catalogCode, stagingItemsCreated: input.body.items.length },
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'context_ingestion_jobs',
          recordId: String(job.id),
          changeType: 'create',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: 'Ingesta de catálogo creada.',
          newValues: { catalogCode: input.body.catalogCode, items: input.body.items.length },
          happenedAt: now,
        },
        { transaction },
      );
      return { ingestionJobId: String(job.id), status: job.status, stagingItemsCreated: input.body.items.length };
    });
  }

  async decideStagingItems(input: { body: StagingDecisionBatchDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const targetVersion = await this.repository.findCatalogVersionById(input.body.targetCatalogVersionId);
    if (!targetVersion) throw new NotFoundException('Versión destino no encontrada.');
    if (!['draft', 'pending_approval'].includes(targetVersion.status ?? ''))
      throw new UnprocessableEntityException('TARGET_VERSION_NOT_EDITABLE');
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      let approved = 0;
      let rejected = 0;
      let itemsCreated = 0;
      for (const decision of input.body.decisions) {
        const staging = await this.repository.findStagingItemById(decision.stagingItemId, { transaction });
        if (!staging) throw new NotFoundException(`Staging item ${decision.stagingItemId} no encontrado.`);
        if (String(staging.catalogId) !== String(targetVersion.catalogId)) {
          throw new UnprocessableEntityException(
            `Staging item ${decision.stagingItemId} pertenece a un catálogo distinto al de la versión destino.`,
          );
        }
        if (decision.decision === 'approve') {
          approved += 1;
          const itemCode = decision.itemCode ?? staging.proposedItemCode;
          const itemName = decision.itemName ?? staging.proposedItemName;
          const itemType = decision.itemType ?? String(staging.proposedAttributesJson?.itemType ?? 'catalog_item');
          if (!itemCode || !itemName) throw new UnprocessableEntityException('APPROVED_STAGING_ITEM_REQUIRES_ITEM_CODE_AND_NAME');
          const item = await this.repository.createContextItem(
            {
              catalogVersionId: input.body.targetCatalogVersionId,
              itemCode,
              itemName,
              itemType,
              attributes: staging.proposedAttributesJson ?? {},
              sourceId: null,
              confidenceScore: null,
              now,
            },
            { transaction },
          );
          itemsCreated += 1;
          for (const alias of decision.aliases) {
            await this.repository.createAlias(
              {
                contextItemId: String(item.id),
                aliasValue: alias.aliasValue,
                aliasType: alias.aliasType,
                normalizedAlias: normalizeAlias(alias.aliasValue),
                confidenceScore: alias.confidenceScore ?? null,
                now,
              },
              { transaction },
            );
          }
          for (const mapping of decision.riskMappings) {
            await this.repository.createRiskMapping(
              {
                contextItemId: String(item.id),
                riskDimension: mapping.riskDimension,
                riskBand: mapping.riskBand,
                scorePointsSuggested: mapping.scorePointsSuggested ?? null,
                reasonCode: mapping.reasonCode,
                explanation: mapping.explanation ?? null,
                modelUsage: mapping.modelUsage ?? null,
                validFrom: mapping.validFrom ?? null,
                validUntil: mapping.validUntil ?? null,
                now,
              },
              { transaction },
            );
          }
          await this.repository.updateStagingItemDecision(
            staging,
            { reviewStatus: 'approved', reviewNotes: decision.decisionReason, now },
            { transaction },
          );
        } else {
          rejected += 1;
          await this.repository.updateStagingItemDecision(
            staging,
            { reviewStatus: 'rejected', reviewNotes: decision.decisionReason, now },
            { transaction },
          );
        }
        await this.repository.createApprovalEvent(
          {
            stagingItemId: decision.stagingItemId,
            catalogVersionId: input.body.targetCatalogVersionId,
            eventType: decision.decision,
            decidedByPlatformUserId: actorPlatformUserId(input.currentUser),
            decidedAt: now,
            decisionReason: decision.decisionReason,
          },
          { transaction },
        );
      }
      await this.repository.createAudit(
        {
          ...auditBase(input.context, input.currentUser),
          actionCode: 'catalog.staging.decision_batch',
          targetType: 'context_catalog_version',
          targetId: input.body.targetCatalogVersionId,
          payload: { processed: input.body.decisions.length, approved, rejected, itemsCreated },
          occurredAt: now,
        },
        { transaction },
      );
      return { processed: input.body.decisions.length, approved, rejected, itemsCreated };
    });
  }
}
