import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import {
  catalogDto,
  catalogVersionDto,
  contextItemDto,
  dataGovernanceDto,
  definitionDtos,
  riskPolicyDto,
} from './catalog-management.mapper.js';
import { CatalogManagementRepository } from './catalog-management.repository.js';
import {
  ActivateRiskRulesetVersionDto,
  CatalogDecisionDto,
  CatalogIngestionDto,
  CreateCatalogVersionDto,
  CreateRiskRulesetVersionDto,
  DataGovernancePolicyPackageDto,
  DefinitionsPackageDto,
  DefinitionsQueryDto,
  ListCatalogsQueryDto,
  StagingDecisionBatchDto,
  SubmitCatalogVersionDto,
} from './catalog-management.schemas.js';

const INTERNAL_ROLES = ['internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system'];

type RequestContext = {
  tenantId: string;
  ipAddress: string | null;
  userAgent: string | null;
  idempotencyKey?: string;
};

function assertInternal(user: AuthenticatedUser): void {
  if (!INTERNAL_ROLES.includes(user.role)) throw new ForbiddenException('Este endpoint es interno.');
}

function requireIdempotency(context: RequestContext): void {
  if (!context.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
}

function actorPlatformUserId(user: AuthenticatedUser): string | null {
  return user.platformUserId ?? null;
}

function normalizeAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function auditBase(context: RequestContext, user: AuthenticatedUser) {
  return {
    tenantId: context.tenantId,
    actorType: user.role,
    actorInternalUserId: user.internalUserId ?? null,
    actorPlatformUserId: actorPlatformUserId(user),
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };
}

@Injectable()
export class CatalogManagementService {
  constructor(
    @Inject(CatalogManagementRepository)
    private readonly repository: CatalogManagementRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async listCatalogs(input: { query: ListCatalogsQueryDto; currentUser: AuthenticatedUser }) {
    assertInternal(input.currentUser);
    const catalogs = await this.repository.listCatalogs(input.query);
    const rows = await Promise.all(
      catalogs.map(async (catalog) => {
        const currentVersion = await this.repository.findLatestVersion(String(catalog.id));
        if (input.query.status !== 'all' && currentVersion?.status !== input.query.status) return null;
        return catalogDto(catalog, currentVersion);
      }),
    );
    return { items: rows.filter((item): item is NonNullable<typeof item> => item !== null) };
  }

  async getCatalogVersion(input: { catalogCode: string; versionId: string; currentUser: AuthenticatedUser }) {
    assertInternal(input.currentUser);
    const catalog = await this.repository.findCatalogByCode(input.catalogCode);
    if (!catalog) throw new NotFoundException('Catálogo no encontrado.');
    const version = await this.repository.findCatalogVersion(String(catalog.id), input.versionId);
    if (!version) throw new NotFoundException('Versión de catálogo no encontrada.');
    const items = await this.repository.findItemsByVersion(String(version.id));
    const itemIds = items.map((item) => String(item.id));
    const [aliases, mappings] = await Promise.all([
      this.repository.findAliasesByItemIds(itemIds),
      this.repository.findRiskMappingsByItemIds(itemIds),
    ]);
    return {
      catalog: catalogDto(catalog, version),
      version: catalogVersionDto(version),
      items: items.map((item) =>
        contextItemDto(
          item,
          aliases.filter((alias) => String(alias.contextItemId) === String(item.id)),
          mappings.filter((mapping) => String(mapping.contextItemId) === String(item.id)),
        ),
      ),
    };
  }

  async createCatalogVersion(input: {
    catalogCode: string;
    body: CreateCatalogVersionDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const catalog = await this.repository.findCatalogByCode(input.catalogCode);
    if (!catalog) throw new NotFoundException('Catálogo no encontrado.');
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      const version = await this.repository.createCatalogVersion(
        {
          catalogId: String(catalog.id),
          versionCode: input.body.versionCode,
          status: 'draft',
          validFrom: input.body.validFrom ?? null,
          validUntil: input.body.validUntil ?? null,
          createdByType: input.currentUser.role,
          createdByPlatformUserId: actorPlatformUserId(input.currentUser),
          notes: input.body.notes ?? null,
          now,
        },
        { transaction },
      );

      let aliasesCreated = 0;
      let riskMappingsCreated = 0;
      for (const item of input.body.items) {
        let sourceId: string | null = null;
        if (item.sourceCode) {
          const source = await this.repository.findSourceByCode(item.sourceCode, { transaction });
          sourceId = source ? String(source.id) : null;
        }
        const createdItem = await this.repository.createContextItem(
          {
            catalogVersionId: String(version.id),
            itemCode: item.itemCode,
            itemName: item.itemName,
            itemType: item.itemType,
            attributes: item.attributes,
            sourceId,
            confidenceScore: item.confidenceScore ?? null,
            now,
          },
          { transaction },
        );
        for (const alias of item.aliases) {
          aliasesCreated += 1;
          await this.repository.createAlias(
            {
              contextItemId: String(createdItem.id),
              aliasValue: alias.aliasValue,
              aliasType: alias.aliasType,
              normalizedAlias: normalizeAlias(alias.aliasValue),
              confidenceScore: alias.confidenceScore ?? null,
              now,
            },
            { transaction },
          );
        }
        for (const mapping of item.riskMappings) {
          riskMappingsCreated += 1;
          await this.repository.createRiskMapping(
            {
              contextItemId: String(createdItem.id),
              riskDimension: mapping.riskDimension,
              riskBand: mapping.riskBand,
              scorePointsSuggested: mapping.scorePointsSuggested ?? null,
              reasonCode: mapping.reasonCode,
              explanation: mapping.explanation ?? null,
              modelUsage: mapping.modelUsage ?? null,
              validFrom: mapping.validFrom ?? input.body.validFrom ?? null,
              validUntil: mapping.validUntil ?? input.body.validUntil ?? null,
              now,
            },
            { transaction },
          );
        }
      }

      await this.repository.createApprovalEvent(
        {
          stagingItemId: null,
          catalogVersionId: String(version.id),
          eventType: 'version_created',
          decidedByPlatformUserId: actorPlatformUserId(input.currentUser),
          decidedAt: now,
          decisionReason: input.body.notes ?? 'Nueva versión de catálogo creada en borrador.',
        },
        { transaction },
      );
      await this.repository.createAudit(
        {
          ...auditBase(input.context, input.currentUser),
          actionCode: 'catalog.version.create',
          targetType: 'context_catalog_version',
          targetId: String(version.id),
          payload: {
            catalogCode: input.catalogCode,
            versionCode: input.body.versionCode,
            itemsCreated: input.body.items.length,
            aliasesCreated,
            riskMappingsCreated,
            idempotencyKeyHash: sha256Hex(input.context.idempotencyKey ?? ''),
          },
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'context_catalog_versions',
          recordId: String(version.id),
          changeType: 'create',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: 'Nueva versión de catálogo creada en paquete.',
          newValues: { catalogCode: input.catalogCode, versionCode: input.body.versionCode, itemsCreated: input.body.items.length },
          happenedAt: now,
        },
        { transaction },
      );

      return {
        catalogCode: input.catalogCode,
        catalogVersionId: String(version.id),
        status: version.status,
        itemsCreated: input.body.items.length,
        aliasesCreated,
        riskMappingsCreated,
      };
    });
  }

  async submitCatalogVersion(input: {
    catalogCode: string;
    versionId: string;
    body: SubmitCatalogVersionDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const catalog = await this.repository.findCatalogByCode(input.catalogCode);
    if (!catalog) throw new NotFoundException('Catálogo no encontrado.');
    const version = await this.repository.findCatalogVersion(String(catalog.id), input.versionId);
    if (!version) throw new NotFoundException('Versión de catálogo no encontrada.');
    if (version.status !== 'draft') throw new UnprocessableEntityException('CATALOG_VERSION_NOT_DRAFT');
    const items = await this.repository.findItemsByVersion(input.versionId);
    if (items.length === 0) throw new UnprocessableEntityException('CATALOG_VERSION_WITHOUT_ITEMS');
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const updated = await this.repository.updateCatalogVersionStatus(
        version,
        { status: 'pending_approval', notes: input.body.notes },
        { transaction },
      );
      await this.repository.createApprovalEvent(
        {
          stagingItemId: null,
          catalogVersionId: input.versionId,
          eventType: 'submitted_for_approval',
          decidedByPlatformUserId: actorPlatformUserId(input.currentUser),
          decidedAt: now,
          decisionReason: input.body.notes,
        },
        { transaction },
      );
      await this.repository.createAudit(
        {
          ...auditBase(input.context, input.currentUser),
          actionCode: 'catalog.version.submit_for_approval',
          targetType: 'context_catalog_version',
          targetId: input.versionId,
          payload: { catalogCode: input.catalogCode },
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'context_catalog_versions',
          recordId: input.versionId,
          changeType: 'status_change',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: input.body.notes,
          newValues: { status: 'pending_approval' },
          happenedAt: now,
        },
        { transaction },
      );
      return { catalogVersionId: String(updated.id), status: updated.status };
    });
  }

  async decideCatalogVersion(input: {
    catalogCode: string;
    versionId: string;
    body: CatalogDecisionDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const catalog = await this.repository.findCatalogByCode(input.catalogCode);
    if (!catalog) throw new NotFoundException('Catálogo no encontrado.');
    const version = await this.repository.findCatalogVersion(String(catalog.id), input.versionId);
    if (!version) throw new NotFoundException('Versión de catálogo no encontrada.');
    const now = new Date();
    const nextStatus =
      input.body.decision === 'approve'
        ? 'approved'
        : input.body.decision === 'publish'
          ? 'published'
          : input.body.decision === 'retire'
            ? 'retired'
            : 'rejected';
    if (input.body.decision === 'publish' && !['approved', 'pending_approval'].includes(version.status ?? ''))
      throw new UnprocessableEntityException('CATALOG_VERSION_NOT_READY_TO_PUBLISH');
    if (input.body.decision === 'approve' && version.status !== 'pending_approval')
      throw new UnprocessableEntityException('CATALOG_VERSION_NOT_PENDING_APPROVAL');
    return this.sequelize.transaction(async (transaction) => {
      const updated = await this.repository.updateCatalogVersionStatus(
        version,
        {
          status: nextStatus,
          approvedByType: input.currentUser.role,
          approvedByPlatformUserId: actorPlatformUserId(input.currentUser),
          approvedAt: ['approve', 'publish'].includes(input.body.decision) ? now : version.approvedAt,
          validFrom: input.body.validFrom ?? version.validFrom,
          validUntil: input.body.validUntil ?? version.validUntil,
        },
        { transaction },
      );
      await this.repository.createApprovalEvent(
        {
          stagingItemId: null,
          catalogVersionId: input.versionId,
          eventType: input.body.decision,
          decidedByPlatformUserId: actorPlatformUserId(input.currentUser),
          decidedAt: now,
          decisionReason: input.body.decisionReason,
        },
        { transaction },
      );
      await this.repository.createAudit(
        {
          ...auditBase(input.context, input.currentUser),
          actionCode: `catalog.version.${input.body.decision}`,
          targetType: 'context_catalog_version',
          targetId: input.versionId,
          payload: { catalogCode: input.catalogCode, decision: input.body.decision },
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'context_catalog_versions',
          recordId: input.versionId,
          changeType: 'decision',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: input.body.decisionReason,
          newValues: { status: nextStatus, decision: input.body.decision },
          happenedAt: now,
        },
        { transaction },
      );
      return {
        catalogVersionId: String(updated.id),
        decision: input.body.decision,
        status: updated.status,
        publishedAt: input.body.decision === 'publish' ? now : null,
      };
    });
  }

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

  async listDefinitions(input: { query: DefinitionsQueryDto; currentUser: AuthenticatedUser }) {
    assertInternal(input.currentUser);
    return definitionDtos(await this.repository.listDefinitions(input.query));
  }

  async upsertDefinitionsPackage(input: { body: DefinitionsPackageDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      let events = 0;
      let observations = 0;
      let attributes = 0;
      let features = 0;
      for (const item of input.body.definitions.events) {
        events += 1;
        await this.repository.upsertEventDefinition(
          {
            eventCode: item.eventCode,
            eventName: item.eventName,
            eventFamily: item.eventFamily ?? input.body.domain,
            sourcePackage: item.sourcePackage ?? input.body.domain,
            targetTablesJson: { tables: item.targetTables },
            expectedPayloadSchemaJson: item.expectedPayloadSchema,
            riskDimension: item.riskDimension ?? null,
            buildPhase: item.buildPhase ?? null,
            dataClassificationCode: item.dataClassificationCode ?? null,
            retentionPolicyId: item.retentionPolicyId ?? null,
            isHighVolume: item.isHighVolume ?? false,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.definitions.observations) {
        observations += 1;
        await this.repository.upsertObservationDefinition(
          {
            observationCode: item.observationCode,
            observationName: item.observationName,
            dataType: item.dataType ?? 'string',
            sourceGroup: item.sourceGroup ?? input.body.domain,
            expectedAvailabilityStage: item.expectedAvailabilityStage ?? null,
            buildPhase: item.buildPhase ?? null,
            dataClassificationCode: item.dataClassificationCode ?? null,
            riskDimension: item.riskDimension ?? null,
            requiresConsent: item.requiresConsent ?? false,
            allowedForCreditDecision: item.allowedForCreditDecision ?? false,
            allowedForFraudDecision: item.allowedForFraudDecision ?? false,
            legalReviewStatus: item.legalReviewStatus ?? 'pending',
            prohibitedReasonCode: null,
            fairnessReviewRequired: item.fairnessReviewRequired ?? false,
            retentionPolicyId: item.retentionPolicyId ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.definitions.attributes) {
        attributes += 1;
        await this.repository.upsertAttributeDefinition(
          {
            attributeCode: item.attributeCode,
            attributeName: item.attributeName,
            entityScope: item.entityScope ?? 'customer',
            dataType: item.dataType ?? 'string',
            riskDimension: item.riskDimension ?? null,
            sourceType: item.sourceType ?? input.body.domain,
            availabilityStage: item.availabilityStage ?? null,
            buildPhase: item.buildPhase ?? null,
            dataClassificationCode: item.dataClassificationCode ?? null,
            requiresConsent: item.requiresConsent ?? false,
            isSensitive: item.isSensitive ?? false,
            isModelCandidate: item.isModelCandidate ?? false,
            allowedForCreditDecision: item.allowedForCreditDecision ?? false,
            allowedForFraudDecision: item.allowedForFraudDecision ?? false,
            legalReviewStatus: item.legalReviewStatus ?? 'pending',
            prohibitedReasonCode: null,
            fairnessReviewRequired: item.fairnessReviewRequired ?? false,
            retentionPolicyId: item.retentionPolicyId ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.definitions.features) {
        features += 1;
        await this.repository.upsertFeatureDefinition(
          {
            featureCode: item.featureCode,
            featureName: item.featureName,
            featureFamily: item.featureFamily ?? input.body.domain,
            riskDimension: item.riskDimension ?? null,
            dataType: item.dataType ?? 'number',
            availabilityTier: item.availabilityTier ?? null,
            buildPhase: item.buildPhase ?? null,
            dataClassificationCode: item.dataClassificationCode ?? null,
            calculationKind: item.calculationKind ?? null,
            defaultMissingStrategy: item.defaultMissingStrategy ?? null,
            isModelInput: item.isModelInput ?? false,
            isPolicyRuleInput: item.isPolicyRuleInput ?? false,
            isSensitive: item.isSensitive ?? false,
            allowedForCreditDecision: item.allowedForCreditDecision ?? false,
            allowedForFraudDecision: item.allowedForFraudDecision ?? false,
            legalReviewStatus: item.legalReviewStatus ?? 'pending',
            prohibitedReasonCode: null,
            fairnessReviewRequired: item.fairnessReviewRequired ?? false,
            retentionPolicyId: item.retentionPolicyId ?? null,
            ownerTeam: item.ownerTeam ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      await this.repository.createAudit(
        {
          ...auditBase(input.context, input.currentUser),
          actionCode: 'definitions.package.upsert',
          targetType: 'definitions_package',
          targetId: input.body.domain,
          payload: { events, observations, attributes, features },
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'definitions',
          recordId: input.body.domain,
          changeType: 'upsert_package',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: 'Paquete de definiciones registrado.',
          newValues: { events, observations, attributes, features },
          happenedAt: now,
        },
        { transaction },
      );
      return {
        domain: input.body.domain,
        eventsProcessed: events,
        observationsProcessed: observations,
        attributesProcessed: attributes,
        featuresProcessed: features,
      };
    });
  }

  async getCurrentRiskPolicy(input: { currentUser: AuthenticatedUser }) {
    assertInternal(input.currentUser);
    const current = await this.repository.listCurrentRiskPolicy();
    const rules = await this.repository.findRulesByRulesetIds(current.rulesetVersions.map((ruleset) => String(ruleset.id)));
    return riskPolicyDto({ ...current, rules });
  }

  async createRiskRulesetVersion(input: { body: CreateRiskRulesetVersionDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const modelVersion = await this.repository.createRiskModelVersion(
        {
          modelCode: input.body.modelVersion.modelCode,
          versionCode: input.body.modelVersion.versionCode,
          modelType: input.body.modelVersion.modelType,
          assessmentType: input.body.modelVersion.assessmentType,
          status: input.body.modelVersion.status,
          effectiveFrom: null,
          effectiveUntil: null,
          approvedByPlatformUserId: null,
          approvedAt: null,
          artifactUrl: input.body.modelVersion.artifactUrl ?? null,
          artifactHash: input.body.modelVersion.artifactHash ?? null,
          createdAtValue: now,
        },
        { transaction },
      );
      const ruleset = await this.repository.createRiskRulesetVersion(
        {
          rulesetCode: input.body.ruleset.rulesetCode,
          versionCode: input.body.ruleset.versionCode,
          assessmentType: input.body.ruleset.assessmentType,
          status: input.body.ruleset.status,
          effectiveFrom: null,
          effectiveUntil: null,
          approvedByPlatformUserId: null,
          approvedAt: null,
          createdAtValue: now,
        },
        { transaction },
      );
      for (const rule of input.body.rules) {
        await this.repository.createRiskPolicyRule(
          {
            rulesetVersionId: String(ruleset.id),
            ruleCode: rule.ruleCode,
            ruleName: rule.ruleName,
            riskDimension: rule.riskDimension,
            ruleType: rule.ruleType,
            severity: rule.severity,
            expressionJson: rule.expressionJson,
            actionCode: rule.actionCode,
            reasonCode: rule.reasonCode,
            isHardStop: rule.isHardStop,
            createdAtValue: now,
          },
          { transaction },
        );
      }
      for (const seed of input.body.riskSignalSeeds) {
        await this.repository.createRiskSignalSeed(
          {
            signalCode: seed.signalCode,
            signalName: seed.signalName,
            signalType: seed.signalType,
            sourceEntity: seed.sourceEntity,
            targetDefinitionCode: seed.targetDefinitionCode ?? null,
            riskDimension: seed.riskDimension ?? null,
            buildPhase: seed.buildPhase ?? null,
            priority: seed.priority ?? null,
            expectedDirection: seed.expectedDirection ?? null,
            exampleValueJson: seed.exampleValue,
            rationale: seed.rationale ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      await this.repository.createAudit(
        {
          ...auditBase(input.context, input.currentUser),
          actionCode: 'risk_policy.ruleset_version.create',
          targetType: 'risk_ruleset_version',
          targetId: String(ruleset.id),
          payload: {
            modelVersionId: String(modelVersion.id),
            rulesCreated: input.body.rules.length,
            seedsCreated: input.body.riskSignalSeeds.length,
          },
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'risk_ruleset_versions',
          recordId: String(ruleset.id),
          changeType: 'create',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: 'Nueva versión de reglas de riesgo creada.',
          newValues: { rulesetCode: ruleset.rulesetCode, versionCode: ruleset.versionCode, rulesCreated: input.body.rules.length },
          happenedAt: now,
        },
        { transaction },
      );
      return {
        riskModelVersionId: String(modelVersion.id),
        riskRulesetVersionId: String(ruleset.id),
        status: ruleset.status,
        rulesCreated: input.body.rules.length,
        riskSignalSeedsCreated: input.body.riskSignalSeeds.length,
      };
    });
  }

  async activateRiskRulesetVersion(input: {
    rulesetVersionId: string;
    body: ActivateRiskRulesetVersionDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const version = await this.repository.findRiskRulesetVersionById(input.rulesetVersionId);
    if (!version) throw new NotFoundException('Versión de reglas no encontrada.');
    if (!['draft', 'inactive', 'approved'].includes(version.status ?? ''))
      throw new UnprocessableEntityException('RULESET_VERSION_NOT_ACTIVATABLE');
    const now = new Date();
    const effectiveFrom = input.body.effectiveFrom ? new Date(input.body.effectiveFrom) : now;
    return this.sequelize.transaction(async (transaction) => {
      const retiredCount = await this.repository.retireOtherActiveRulesets(version.rulesetCode, input.rulesetVersionId, effectiveFrom, {
        transaction,
      });
      const activated = await this.repository.activateRuleset(
        version,
        { approvedByPlatformUserId: actorPlatformUserId(input.currentUser), effectiveFrom, now },
        { transaction },
      );
      await this.repository.createAudit(
        {
          ...auditBase(input.context, input.currentUser),
          actionCode: 'risk_policy.ruleset_version.activate',
          targetType: 'risk_ruleset_version',
          targetId: input.rulesetVersionId,
          payload: { activationReason: input.body.activationReason, retiredCount },
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'risk_ruleset_versions',
          recordId: input.rulesetVersionId,
          changeType: 'activate',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: input.body.activationReason,
          newValues: { status: 'active', effectiveFrom: effectiveFrom.toISOString(), retiredCount },
          happenedAt: now,
        },
        { transaction },
      );
      return {
        riskRulesetVersionId: String(activated.id),
        status: activated.status,
        effectiveFrom: activated.effectiveFrom,
        retiredPreviousActiveRulesets: retiredCount,
      };
    });
  }

  async getDataGovernancePolicies(input: { currentUser: AuthenticatedUser }) {
    assertInternal(input.currentUser);
    return dataGovernanceDto(await this.repository.listDataGovernancePolicies());
  }

  async upsertDataGovernancePackage(input: {
    body: DataGovernancePolicyPackageDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      let privacyPurposes = 0;
      let retentionPolicies = 0;
      let dataProviders = 0;
      let classificationPolicies = 0;
      let sensitiveFieldRules = 0;
      let dataQualityRules = 0;
      for (const item of input.body.privacyPurposes) {
        privacyPurposes += 1;
        await this.repository.upsertPrivacyPurpose(
          {
            purposeCode: item.purposeCode,
            purposeName: item.purposeName,
            legalBasis: item.legalBasis ?? null,
            description: item.description ?? null,
            requiresExplicitConsent: item.requiresExplicitConsent,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.retentionPolicies) {
        retentionPolicies += 1;
        await this.repository.upsertRetentionPolicy(
          {
            policyCode: item.policyCode,
            appliesTo: item.appliesTo,
            retentionDays: item.retentionDays,
            postRetentionAction: item.postRetentionAction,
            legalBasis: item.legalBasis ?? null,
            description: item.description ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.dataProviders) {
        dataProviders += 1;
        await this.repository.upsertDataProvider(
          {
            providerCode: item.providerCode,
            providerName: item.providerName,
            providerType: item.providerType,
            reliabilityScore: item.reliabilityScore ?? null,
            supportsRetroData: item.supportsRetroData,
            defaultRetentionPolicyId: item.defaultRetentionPolicyId ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.classificationPolicies) {
        classificationPolicies += 1;
        await this.repository.upsertClassificationPolicy(
          {
            classificationCode: item.classificationCode,
            classificationName: item.classificationName,
            sensitivityLevel: item.sensitivityLevel,
            allowedStorageModesJson: item.allowedStorageModes,
            defaultStorageMode: item.defaultStorageMode ?? null,
            defaultRetentionPolicyId: item.defaultRetentionPolicyId ?? null,
            encryptionRequired: item.encryptionRequired,
            hashingRequired: item.hashingRequired,
            rawStorageAllowed: item.rawStorageAllowed,
            description: item.description ?? null,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.sensitiveFieldRules) {
        sensitiveFieldRules += 1;
        await this.repository.upsertSensitiveFieldRule(
          {
            tableName: item.tableName,
            fieldName: item.fieldName,
            classificationCode: item.classificationCode,
            storageMode: item.storageMode,
            searchStrategy: item.searchStrategy ?? null,
            maskingStrategy: item.maskingStrategy ?? null,
            accessPolicyCode: item.accessPolicyCode ?? null,
            retentionPolicyId: item.retentionPolicyId ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.dataQualityRules) {
        dataQualityRules += 1;
        await this.repository.upsertDataQualityRule(
          {
            ruleCode: item.ruleCode,
            ruleName: item.ruleName,
            targetTable: item.targetTable,
            targetField: item.targetField ?? null,
            severity: item.severity,
            expressionJson: item.expressionJson,
            expectedAction: item.expectedAction,
            buildPhase: item.buildPhase ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      await this.repository.createAudit(
        {
          ...auditBase(input.context, input.currentUser),
          actionCode: 'data_governance.policy_package.upsert',
          targetType: 'data_governance_policy_package',
          targetId: 'current',
          payload: { privacyPurposes, retentionPolicies, dataProviders, classificationPolicies, sensitiveFieldRules, dataQualityRules },
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'data_governance_policies',
          recordId: 'package',
          changeType: 'upsert_package',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: 'Paquete de gobierno de datos registrado.',
          newValues: { privacyPurposes, retentionPolicies, dataProviders, classificationPolicies, sensitiveFieldRules, dataQualityRules },
          happenedAt: now,
        },
        { transaction },
      );
      return {
        privacyPurposesProcessed: privacyPurposes,
        retentionPoliciesProcessed: retentionPolicies,
        dataProvidersProcessed: dataProviders,
        classificationPoliciesProcessed: classificationPolicies,
        sensitiveFieldRulesProcessed: sensitiveFieldRules,
        dataQualityRulesProcessed: dataQualityRules,
      };
    });
  }
}
