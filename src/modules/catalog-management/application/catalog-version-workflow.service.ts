import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CatalogManagementRepository } from '../catalog-management.repository.js';
import { CatalogDecisionDto, CreateCatalogVersionDto, SubmitCatalogVersionDto } from '../catalog-management.schemas.js';
import {
  actorPlatformUserId,
  assertAdmin,
  assertInternal,
  auditBase,
  normalizeAlias,
  RequestContext,
  requireIdempotency,
} from './catalog-management.shared.js';

@Injectable()
export class CatalogVersionWorkflowService {
  constructor(
    private readonly repository: CatalogManagementRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

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
    assertAdmin(input.currentUser);
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
}
