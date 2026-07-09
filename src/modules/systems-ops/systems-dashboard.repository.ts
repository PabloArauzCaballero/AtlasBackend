import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import {
  SystemActionLogModel,
  SystemDataEntityCatalogModel,
  SystemEndpointCatalogModel,
  SystemEndpointDataEntityImpactModel,
  SystemEndpointFieldImpactModel,
  SystemEndpointToolRequirementModel,
  SystemStressProfileModel,
  SystemTestSuiteModel,
  SystemToolCatalogModel,
} from '../../database/models/index.js';

@Injectable()
export class SystemsDashboardRepository {
  constructor(
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel,
    @InjectModel(SystemToolCatalogModel) private readonly toolModel: typeof SystemToolCatalogModel,
    @InjectModel(SystemDataEntityCatalogModel) private readonly dataEntityModel: typeof SystemDataEntityCatalogModel,
    @InjectModel(SystemTestSuiteModel) private readonly suiteModel: typeof SystemTestSuiteModel,
    @InjectModel(SystemStressProfileModel) private readonly stressProfileModel: typeof SystemStressProfileModel,
    @InjectModel(SystemActionLogModel) private readonly actionLogModel: typeof SystemActionLogModel,
    @InjectModel(SystemEndpointDataEntityImpactModel) private readonly dataImpactModel: typeof SystemEndpointDataEntityImpactModel,
    @InjectModel(SystemEndpointFieldImpactModel) private readonly fieldImpactModel: typeof SystemEndpointFieldImpactModel,
    @InjectModel(SystemEndpointToolRequirementModel) private readonly endpointToolModel: typeof SystemEndpointToolRequirementModel,
  ) {}

  async getDashboardCounts(): Promise<Record<string, number>> {
    const [endpoints, tools, dataEntities, testSuites, pendingReviews, stressProfiles, actionLogs24h] = await Promise.all([
      this.endpointModel.count(),
      this.toolModel.count(),
      this.dataEntityModel.count(),
      this.suiteModel.count(),
      this.countPendingReviews(),
      this.stressProfileModel.count({ where: { isEnabled: true } } as FindOptions),
      this.actionLogModel.count({ where: { occurredAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } } } as FindOptions),
    ]);
    return { endpoints, tools, dataEntities, testSuites, pendingReviews, stressProfiles, actionLogs24h };
  }

  async countPendingReviews(): Promise<number> {
    const [endpoints, entities, dataImpacts, fieldImpacts, toolRequirements] = await Promise.all([
      this.endpointModel.count({ where: { reviewStatus: 'NEEDS_REVIEW' } } as FindOptions),
      this.dataEntityModel.count({ where: { reviewStatus: 'NEEDS_REVIEW' } } as FindOptions),
      this.dataImpactModel.count({ where: { reviewStatus: 'NEEDS_REVIEW' } } as FindOptions),
      this.fieldImpactModel.count({ where: { reviewStatus: 'NEEDS_REVIEW' } } as FindOptions),
      this.endpointToolModel.count({ where: { reviewStatus: 'NEEDS_REVIEW' } } as FindOptions),
    ]);
    return endpoints + entities + dataImpacts + fieldImpacts + toolRequirements;
  }
}
