/**
 * @file Puerto de persistencia del versionado de catálogos: catálogos, versiones, ítems, alias, mapeos y fuentes.
 * @business Una versión de catálogo es lo que el negocio aprueba y activa; este repositorio es el único que toca esas tablas.
 * @system implementa consultas y escrituras transaccionales del agregado catálogo-versión (sin ingesta ni auditoría).
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, WhereOptions } from 'sequelize';
import { listCatalogPage } from './catalog-list.query.js';
import {
  ContextApprovalEventModel,
  ContextCatalogModel,
  ContextCatalogVersionModel,
  ContextItemAliasModel,
  ContextItemModel,
  ContextRiskMappingModel,
  ContextSourceModel,
} from '../../database/models/index.js';
import { RepositoryOptions } from './catalog-repository.helpers.js';
import { ListCatalogsQueryDto } from './catalog-management.schemas.js';

@Injectable()
export class CatalogVersionsRepository {
  constructor(
    @InjectModel(ContextCatalogModel) private readonly catalogModel: typeof ContextCatalogModel,
    @InjectModel(ContextCatalogVersionModel) private readonly catalogVersionModel: typeof ContextCatalogVersionModel,
    @InjectModel(ContextItemModel) private readonly contextItemModel: typeof ContextItemModel,
    @InjectModel(ContextItemAliasModel) private readonly contextItemAliasModel: typeof ContextItemAliasModel,
    @InjectModel(ContextRiskMappingModel) private readonly contextRiskMappingModel: typeof ContextRiskMappingModel,
    @InjectModel(ContextSourceModel) private readonly contextSourceModel: typeof ContextSourceModel,
    @InjectModel(ContextApprovalEventModel) private readonly contextApprovalEventModel: typeof ContextApprovalEventModel,
  ) {}

  /** Página de catálogos con filtro, total y `summary` en SQL (ver `catalog-list.query.ts`). */
  listCatalogs(query: ListCatalogsQueryDto) {
    return listCatalogPage(this.catalogModel, query);
  }

  findCatalogByCode(catalogCode: string, options: RepositoryOptions = {}): Promise<ContextCatalogModel | null> {
    return this.catalogModel.findOne({ where: { catalogCode }, transaction: options.transaction } as FindOptions);
  }

  findLatestVersion(catalogId: string): Promise<ContextCatalogVersionModel | null> {
    return this.catalogVersionModel.findOne({
      where: { catalogId },
      order: [
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  /**
   * Batch de `findLatestVersion` para varios catálogos a la vez — usada por
   * `CatalogQueryService.listCatalogs` para no disparar un `findLatestVersion` por catálogo
   * listado (N+1). Trae todas las versiones de los catálogos pedidos en una sola query, ya
   * ordenadas por catálogo y fecha, y arma en memoria un mapa catalogId -> versión más reciente.
   */
  async findLatestVersionsByCatalogIds(catalogIds: readonly string[]): Promise<Map<string, ContextCatalogVersionModel>> {
    if (catalogIds.length === 0) return new Map();
    const versions = await this.catalogVersionModel.findAll({
      where: { catalogId: { [Op.in]: [...catalogIds] } } as WhereOptions,
      order: [
        ['catalogId', 'ASC'],
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);

    const latestByCatalogId = new Map<string, ContextCatalogVersionModel>();
    for (const version of versions) {
      const catalogId = String(version.catalogId);
      if (!latestByCatalogId.has(catalogId)) {
        latestByCatalogId.set(catalogId, version);
      }
    }
    return latestByCatalogId;
  }

  findCatalogVersion(catalogId: string, versionId: string, options: RepositoryOptions = {}): Promise<ContextCatalogVersionModel | null> {
    return this.catalogVersionModel.findOne({ where: { id: versionId, catalogId }, transaction: options.transaction } as FindOptions);
  }

  findCatalogVersionById(versionId: string, options: RepositoryOptions = {}): Promise<ContextCatalogVersionModel | null> {
    return this.catalogVersionModel.findOne({ where: { id: versionId }, transaction: options.transaction } as FindOptions);
  }

  findItemsByVersion(catalogVersionId: string, options: RepositoryOptions = {}): Promise<ContextItemModel[]> {
    return this.contextItemModel.findAll({
      where: { catalogVersionId },
      order: [['itemCode', 'ASC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  findAliasesByItemIds(itemIds: string[], options: RepositoryOptions = {}): Promise<ContextItemAliasModel[]> {
    if (itemIds.length === 0) return Promise.resolve([]);
    return this.contextItemAliasModel.findAll({
      where: { contextItemId: { [Op.in]: itemIds } },
      order: [['aliasValue', 'ASC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  findRiskMappingsByItemIds(itemIds: string[], options: RepositoryOptions = {}): Promise<ContextRiskMappingModel[]> {
    if (itemIds.length === 0) return Promise.resolve([]);
    return this.contextRiskMappingModel.findAll({
      where: { contextItemId: { [Op.in]: itemIds } },
      order: [['riskDimension', 'ASC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  findSourceByCode(sourceCode: string, options: RepositoryOptions = {}): Promise<ContextSourceModel | null> {
    return this.contextSourceModel.findOne({ where: { sourceCode }, transaction: options.transaction } as FindOptions);
  }

  createSource(
    values: { sourceCode: string; sourceName: string; sourceType: string; reliabilityScore?: string | null; now: Date },
    options: RepositoryOptions,
  ): Promise<ContextSourceModel> {
    return this.contextSourceModel.create(
      {
        sourceCode: values.sourceCode,
        sourceName: values.sourceName,
        sourceType: values.sourceType,
        reliabilityScore: values.reliabilityScore ?? null,
        refreshFrequency: null,
        notes: null,
        isActive: true,
        createdAtValue: values.now,
        updatedAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  createCatalogVersion(
    values: {
      catalogId: string;
      versionCode: string;
      status: string;
      validFrom: string | null;
      validUntil: string | null;
      createdByType: string;
      createdByPlatformUserId: string | null;
      notes: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ContextCatalogVersionModel> {
    return this.catalogVersionModel.create(
      {
        catalogId: values.catalogId,
        versionCode: values.versionCode,
        status: values.status,
        validFrom: values.validFrom,
        validUntil: values.validUntil,
        createdByType: values.createdByType,
        createdByPlatformUserId: values.createdByPlatformUserId,
        approvedByType: null,
        approvedByPlatformUserId: null,
        approvedAt: null,
        notes: values.notes,
        createdAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  createContextItem(
    values: {
      catalogVersionId: string;
      itemCode: string;
      itemName: string;
      itemType: string;
      attributes: Record<string, unknown>;
      sourceId: string | null;
      confidenceScore: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ContextItemModel> {
    return this.contextItemModel.create(
      {
        catalogVersionId: values.catalogVersionId,
        itemCode: values.itemCode,
        itemName: values.itemName,
        itemType: values.itemType,
        attributesJson: values.attributes,
        sourceId: values.sourceId,
        confidenceScore: values.confidenceScore,
        isActive: true,
        createdAtValue: values.now,
        updatedAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  createAlias(
    values: {
      contextItemId: string;
      aliasValue: string;
      aliasType: string;
      normalizedAlias: string;
      confidenceScore: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ContextItemAliasModel> {
    return this.contextItemAliasModel.create(
      {
        contextItemId: values.contextItemId,
        aliasValue: values.aliasValue,
        aliasType: values.aliasType,
        normalizedAlias: values.normalizedAlias,
        confidenceScore: values.confidenceScore,
        createdAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  createRiskMapping(
    values: {
      contextItemId: string;
      riskDimension: string;
      riskBand: string;
      scorePointsSuggested: string | null;
      reasonCode: string;
      explanation: string | null;
      modelUsage: string | null;
      validFrom: string | null;
      validUntil: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ContextRiskMappingModel> {
    return this.contextRiskMappingModel.create(
      {
        contextItemId: values.contextItemId,
        riskDimension: values.riskDimension,
        riskBand: values.riskBand,
        scorePointsSuggested: values.scorePointsSuggested,
        reasonCode: values.reasonCode,
        explanation: values.explanation,
        modelUsage: values.modelUsage,
        validFrom: values.validFrom,
        validUntil: values.validUntil,
        createdAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  async updateCatalogVersionStatus(
    version: ContextCatalogVersionModel,
    values: {
      status: string;
      notes?: string | null;
      approvedByType?: string | null;
      approvedByPlatformUserId?: string | null;
      approvedAt?: Date | null;
      validFrom?: string | null;
      validUntil?: string | null;
    },
    options: RepositoryOptions,
  ): Promise<ContextCatalogVersionModel> {
    version.status = values.status;
    if (values.notes !== undefined) version.notes = values.notes;
    if (values.approvedByType !== undefined) version.approvedByType = values.approvedByType;
    if (values.approvedByPlatformUserId !== undefined) version.approvedByPlatformUserId = values.approvedByPlatformUserId;
    if (values.approvedAt !== undefined) version.approvedAt = values.approvedAt;
    if (values.validFrom !== undefined) version.validFrom = values.validFrom;
    if (values.validUntil !== undefined) version.validUntil = values.validUntil;
    return version.save({ transaction: options.transaction });
  }

  createApprovalEvent(
    values: {
      stagingItemId: string | null;
      catalogVersionId: string | null;
      eventType: string;
      decidedByPlatformUserId: string | null;
      decidedAt: Date;
      decisionReason: string;
    },
    options: RepositoryOptions,
  ): Promise<ContextApprovalEventModel> {
    return this.contextApprovalEventModel.create(
      {
        stagingItemId: values.stagingItemId,
        catalogVersionId: values.catalogVersionId,
        eventType: values.eventType,
        decidedByPlatformUserId: values.decidedByPlatformUserId,
        decidedAt: values.decidedAt,
        decisionReason: values.decisionReason,
        createdAtValue: values.decidedAt,
      } as any,
      { transaction: options.transaction },
    );
  }
}
