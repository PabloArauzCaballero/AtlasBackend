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
  RiskPolicyRuleModel,
  RiskRuleFiredModel,
  RiskRulesetVersionModel,
  WatchlistMatchModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module.js';
import { RiskController } from './risk.controller.js';
import { RiskPolicyDecisionService } from './application/risk-policy-decision.service.js';
import { RiskPolicyRepository } from './repositories/risk-policy.repository.js';
import { RiskRepository } from './risk.repository.js';
import { RiskService } from './risk.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      RiskAssessmentResultModel,
      RiskAssessmentRunModel,
      RiskAssessmentContextModel,
      RiskPolicyRuleModel,
      RiskRuleFiredModel,
      RiskRulesetVersionModel,
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
    // La evaluación de riesgo consulta primero al motor de políticas versionadas; `risk_heuristic_v0`
    // pasa a ser el último recurso, que es el lugar que su propio autor le asignó.
    DecisionEngineModule,
  ],
  controllers: [RiskController],
  providers: [RiskRepository, RiskPolicyRepository, RiskPolicyDecisionService, RiskService],
  exports: [RiskRepository, RiskService],
})
export class RiskModule {}
