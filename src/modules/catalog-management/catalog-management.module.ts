import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AttributeDefinitionModel,
  ContextApprovalEventModel,
  ContextCatalogModel,
  ContextCatalogVersionModel,
  ContextIngestionJobModel,
  ContextItemAliasModel,
  ContextItemModel,
  ContextRiskMappingModel,
  ContextSourceModel,
  ContextStagingItemModel,
  DataChangeLogModel,
  DataClassificationPolicyModel,
  DataProviderModel,
  DataQualityRuleModel,
  EventDefinitionModel,
  FeatureDefinitionModel,
  ObservationDefinitionModel,
  OperationalAuditLogModel,
  PrivacyProcessingPurposeModel,
  RetentionPolicyModel,
  RiskModelVersionModel,
  RiskPolicyRuleModel,
  RiskRulesetVersionModel,
  RiskSignalSeedModel,
  SensitiveFieldRuleModel,
} from '../../database/models/index.js';
import { CatalogManagementController } from './catalog-management.controller.js';
import { CatalogManagementRepository } from './catalog-management.repository.js';
import { CatalogManagementService } from './catalog-management.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      ContextCatalogModel,
      ContextCatalogVersionModel,
      ContextItemModel,
      ContextItemAliasModel,
      ContextRiskMappingModel,
      ContextSourceModel,
      ContextStagingItemModel,
      ContextApprovalEventModel,
      ContextIngestionJobModel,
      ObservationDefinitionModel,
      EventDefinitionModel,
      AttributeDefinitionModel,
      FeatureDefinitionModel,
      RiskModelVersionModel,
      RiskRulesetVersionModel,
      RiskPolicyRuleModel,
      RiskSignalSeedModel,
      PrivacyProcessingPurposeModel,
      RetentionPolicyModel,
      DataProviderModel,
      DataClassificationPolicyModel,
      SensitiveFieldRuleModel,
      DataQualityRuleModel,
      OperationalAuditLogModel,
      DataChangeLogModel,
    ]),
  ],
  controllers: [CatalogManagementController],
  providers: [CatalogManagementService, CatalogManagementRepository],
})
export class CatalogManagementModule {}
