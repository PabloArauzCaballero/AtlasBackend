/**
 * @file Puerto de persistencia de la ingesta de catálogos: trabajos de ingesta y filas en staging.
 * @business La ingesta propone ítems que una persona acepta o rechaza antes de entrar a una versión; aquí se guarda esa propuesta y su decisión.
 * @system implementa creación de trabajos, staging y decisión sobre cada fila en staging.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { ContextIngestionJobModel, ContextStagingItemModel } from '../../database/models/index.js';
import { lockedRead, RepositoryOptions } from './catalog-repository.helpers.js';

@Injectable()
export class CatalogIngestionRepository {
  constructor(
    @InjectModel(ContextStagingItemModel) private readonly contextStagingItemModel: typeof ContextStagingItemModel,
    @InjectModel(ContextIngestionJobModel) private readonly contextIngestionJobModel: typeof ContextIngestionJobModel,
  ) {}

  createIngestionJob(
    values: {
      jobCode: string;
      sourceType: string;
      sourceName: string;
      triggeredByType: string;
      triggeredByPlatformUserId: string | null;
      status: string;
      summary: Record<string, unknown>;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ContextIngestionJobModel> {
    return this.contextIngestionJobModel.create(
      {
        jobCode: values.jobCode,
        sourceType: values.sourceType,
        sourceName: values.sourceName,
        triggeredByType: values.triggeredByType,
        triggeredByPlatformUserId: values.triggeredByPlatformUserId,
        status: values.status,
        startedAt: values.now,
        finishedAt: values.now,
        summaryJson: values.summary,
        createdAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  createStagingItem(
    values: {
      catalogId: string;
      ingestionJobId: string;
      proposedItemCode: string | null;
      proposedItemName: string;
      proposedAttributes: Record<string, unknown>;
      aiSuggested: boolean;
      createdByType: string;
      createdByPlatformUserId: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ContextStagingItemModel> {
    return this.contextStagingItemModel.create(
      {
        catalogId: values.catalogId,
        ingestionJobId: values.ingestionJobId,
        proposedItemCode: values.proposedItemCode,
        proposedItemName: values.proposedItemName,
        proposedAttributesJson: values.proposedAttributes,
        aiSuggested: values.aiSuggested,
        reviewStatus: 'pending_review',
        reviewNotes: null,
        createdByType: values.createdByType,
        createdByPlatformUserId: values.createdByPlatformUserId,
        createdAtValue: values.now,
        updatedAtValue: values.now,
      } as any,
      { transaction: options.transaction },
    );
  }

  findStagingItemById(stagingItemId: string, options: RepositoryOptions = {}): Promise<ContextStagingItemModel | null> {
    return this.contextStagingItemModel.findOne({ where: { id: stagingItemId }, ...lockedRead(options) } as FindOptions);
  }

  async updateStagingItemDecision(
    item: ContextStagingItemModel,
    values: { reviewStatus: string; reviewNotes: string; now: Date },
    options: RepositoryOptions,
  ): Promise<ContextStagingItemModel> {
    item.reviewStatus = values.reviewStatus;
    item.reviewNotes = values.reviewNotes;
    item.updatedAtValue = values.now;
    return item.save({ transaction: options.transaction });
  }
}
