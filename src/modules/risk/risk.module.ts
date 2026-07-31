/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
 * @system calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerIdentityDocumentModel,
  DataChangeLogModel,
  DataQualityIssueModel,
  FeatureComputationRunModel,
  FeatureLineageLinkModel,
  FeatureSnapshotModel,
  FeatureValueModel,
  FraudCaseModel,
  ManualReviewCaseModel,
  OperationalAuditLogModel,
  RiskAssessmentContextModel,
  RiskAssessmentResultModel,
  RiskAssessmentRunModel,
  RiskFeatureContributionModel,
  RiskRuleFiredModel,
  WatchlistMatchModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { RiskController } from './risk.controller.js';
import { RiskRepository } from './risk.repository.js';
import { RiskService } from './risk.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      RiskAssessmentResultModel,
      RiskAssessmentRunModel,
      RiskAssessmentContextModel,
      RiskRuleFiredModel,
      RiskFeatureContributionModel,
      FeatureComputationRunModel,
      FeatureValueModel,
      FeatureLineageLinkModel,
      FeatureSnapshotModel,
      ManualReviewCaseModel,
      FraudCaseModel,
      WatchlistMatchModel,
      DataQualityIssueModel,
      DataChangeLogModel,
      OperationalAuditLogModel,
      CustomerConsentModel,
      CustomerContactMethodModel,
      CustomerIdentityDocumentModel,
    ]),
    CustomersModule,
  ],
  controllers: [RiskController],
  providers: [RiskRepository, RiskService],
  exports: [RiskRepository, RiskService],
})
export class RiskModule {}
