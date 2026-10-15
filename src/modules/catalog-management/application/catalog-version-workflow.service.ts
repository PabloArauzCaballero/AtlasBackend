/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
 * @system implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CatalogAuditRepository } from '../catalog-audit.repository.js';
import { CatalogVersionsRepository } from '../catalog-versions.repository.js';
import { CatalogDecisionDto, CreateCatalogVersionDto, SubmitCatalogVersionDto } from '../catalog-management.schemas.js';
import {
  actorPlatformUserId,
  assertAdmin,
  assertInternal,
  auditBase,
  RequestContext,
  requireIdempotency,
} from './catalog-management.shared.js';
import { persistVersionItems } from './catalog-version-items.writer.js';
import { assertDecisionAllowed } from './catalog-version-transitions.js';

@Injectable()
export class CatalogVersionWorkflowService {
  constructor(
    private readonly audit: CatalogAuditRepository,
    private readonly versions: CatalogVersionsRepository,
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
    const catalog = await this.versions.findCatalogByCode(input.catalogCode);
    if (!catalog) throw new NotFoundException('Catálogo no encontrado.');
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      const version = await this.versions.createCatalogVersion(
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

      const { aliasesCreated, riskMappingsCreated } = await persistVersionItems({
        versions: this.versions,
        versionId: String(version.id),
        body: input.body,
        now,
        transaction,
      });

      await this.versions.createApprovalEvent(
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
      await this.audit.createAudit(
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
      await this.audit.createDataChange(
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
    const catalog = await this.versions.findCatalogByCode(input.catalogCode);
    if (!catalog) throw new NotFoundException('Catálogo no encontrado.');
    const version = await this.versions.findCatalogVersion(String(catalog.id), input.versionId);
    if (!version) throw new NotFoundException('Versión de catálogo no encontrada.');
    if (version.status !== 'draft') throw new UnprocessableEntityException('CATALOG_VERSION_NOT_DRAFT');
    const items = await this.versions.findItemsByVersion(input.versionId);
    if (items.length === 0) throw new UnprocessableEntityException('CATALOG_VERSION_WITHOUT_ITEMS');
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const updated = await this.versions.updateCatalogVersionStatus(
        version,
        { status: 'pending_approval', notes: input.body.notes },
        { transaction },
      );
      await this.versions.createApprovalEvent(
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
      await this.audit.createAudit(
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
      await this.audit.createDataChange(
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
    const catalog = await this.versions.findCatalogByCode(input.catalogCode);
    if (!catalog) throw new NotFoundException('Catálogo no encontrado.');
    const version = await this.versions.findCatalogVersion(String(catalog.id), input.versionId);
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
    assertDecisionAllowed(input.body.decision, version.status);
    return this.sequelize.transaction(async (transaction) => {
      const updated = await this.versions.updateCatalogVersionStatus(
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
      await this.versions.createApprovalEvent(
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
      await this.audit.createAudit(
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
      await this.audit.createDataChange(
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
