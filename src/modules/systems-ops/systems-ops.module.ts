import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  SystemActionLogModel,
  SystemJobRunModel,
  SystemStressProfileModel,
  SystemDataEntityCatalogModel,
  SystemEndpointCatalogModel,
  SystemEndpointDataEntityImpactModel,
  SystemEndpointFieldImpactModel,
  SystemEndpointToolRequirementModel,
  SystemTestRunModel,
  SystemTestStepModel,
  SystemTestStepRunModel,
  SystemTestSuiteModel,
  SystemToolCatalogModel,
  SystemDomainCatalogModel,
  SystemEndpointPayloadContractModel,
  SystemDataFieldCatalogModel,
  SystemDataRelationshipCatalogModel,
  SystemOperationalRuleCatalogModel,
} from '../../database/models/index.js';
import { EndpointDiscoveryService } from './endpoint-discovery.service.js';
import { SystemsCatalogClassifierService } from './systems-catalog-classifier.service.js';
import { SystemsCatalogSeedService } from './systems-catalog-seed.service.js';
import { SystemsHealthService } from './systems-health.service.js';
import { SystemsStressRunService } from './systems-stress-run.service.js';
import { SystemsActionLogController } from './systems-action-log.controller.js';
import { SystemsCatalogController } from './systems-catalog.controller.js';
import { SystemsReviewController } from './systems-review.controller.js';
import { SystemsStressController } from './systems-stress.controller.js';
import { SystemsTestController } from './systems-test.controller.js';
import { SystemsActionLogRepository } from './systems-action-log.repository.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import { SystemsDashboardRepository } from './systems-dashboard.repository.js';
import { SystemsReviewRepository } from './systems-review.repository.js';
import { SystemsStressProfileRepository } from './systems-stress-profile.repository.js';
import { SystemsTestExecutionRepository } from './systems-test-execution.repository.js';
import { SystemsActionLogQueryService } from './systems-action-log-query.service.js';
import { SystemsCatalogQueryService } from './systems-catalog-query.service.js';
import { SystemsReviewService } from './systems-review.service.js';
import { SystemsStressProfileService } from './systems-stress-profile.service.js';
import { SystemsTestQueryService } from './systems-test-query.service.js';
import { SystemsTestAssertionService } from './systems-test-assertion.service.js';
import { SystemsTestSuiteAdminRepository } from './systems-test-suite-admin.repository.js';
import { SystemsTestSuiteAdminService } from './systems-test-suite-admin.service.js';
import { SystemsTestHttpClientService } from './systems-test-http-client.service.js';
import { SystemsTestRunnerService } from './systems-test-runner.service.js';
import { SystemsTestTemplateService } from './systems-test-template.service.js';
import { SystemsToolInferenceRepository } from './systems-tool-inference.repository.js';
import { SystemsToolInferenceService } from './systems-tool-inference.service.js';
import { SystemsDataImpactInferenceRepository } from './systems-data-impact-inference.repository.js';
import { SystemsDataImpactInferenceService } from './systems-data-impact-inference.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      SystemEndpointCatalogModel,
      SystemToolCatalogModel,
      SystemEndpointToolRequirementModel,
      SystemDataEntityCatalogModel,
      SystemEndpointDataEntityImpactModel,
      SystemEndpointFieldImpactModel,
      SystemTestSuiteModel,
      SystemTestStepModel,
      SystemTestRunModel,
      SystemTestStepRunModel,
      SystemActionLogModel,
      SystemJobRunModel,
      SystemStressProfileModel,
      SystemDomainCatalogModel,
      SystemEndpointPayloadContractModel,
      SystemDataFieldCatalogModel,
      SystemDataRelationshipCatalogModel,
      SystemOperationalRuleCatalogModel,
    ]),
  ],
  controllers: [
    SystemsCatalogController,
    SystemsReviewController,
    SystemsTestController,
    SystemsStressController,
    SystemsActionLogController,
  ],
  providers: [
    SystemsCatalogQueryService,
    SystemsReviewService,
    SystemsTestQueryService,
    SystemsStressProfileService,
    SystemsActionLogQueryService,
    SystemsCatalogRepository,
    SystemsTestExecutionRepository,
    SystemsActionLogRepository,
    SystemsDashboardRepository,
    SystemsReviewRepository,
    SystemsStressProfileRepository,
    EndpointDiscoveryService,
    SystemsCatalogClassifierService,
    SystemsCatalogSeedService,
    SystemsHealthService,
    SystemsTestRunnerService,
    SystemsTestAssertionService,
    SystemsTestHttpClientService,
    SystemsTestTemplateService,
    SystemsTestSuiteAdminRepository,
    SystemsTestSuiteAdminService,
    SystemsToolInferenceRepository,
    SystemsToolInferenceService,
    SystemsDataImpactInferenceRepository,
    SystemsDataImpactInferenceService,
    SystemsStressRunService,
  ],
})
export class SystemsOpsModule {}
