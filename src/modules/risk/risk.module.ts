/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
 * @system calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado.
 */
import { Module } from '@nestjs/common';
import { RISK_INPUT_FACTS_PORT } from './application/ports/risk-input-facts.port.js';
import { LocalRiskInputFactsAdapter } from './infrastructure/local-risk-input-facts.adapter.js';
import { LocalRiskFraudFactsReader } from './infrastructure/local-risk-fraud-facts.reader.js';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerIdentityDocumentModel,
  OnboardingBehaviorSummaryModel,
  CustomerSessionModel,
  CustomerDeviceLinkModel,
  DeviceSnapshotModel,
  CustomerLocationPingModel,
  CustomerDeviceContactModel,
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
import { RiskReviewCallbackController } from './risk-review-callback.controller.js';
import { RiskManualReviewOutcomeService } from './application/risk-manual-review-outcome.service.js';
import { RiskPolicyDecisionService } from './application/risk-policy-decision.service.js';
import { RiskPolicyRepository } from './repositories/risk-policy.repository.js';
import { RiskRepository } from './risk.repository.js';
import { RevisionManualRepository } from './repositories/revision-manual.repository.js';
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
      // El último resumen de comportamiento del alta, leído por `LocalRiskInputFactsAdapter` (plan F3, H-10).
      OnboardingBehaviorSummaryModel,
      // Los hechos de fraude del alta (`LocalRiskFraudFactsReader`): sesiones con IP y dispositivo, vínculos, snapshots, rastro y agenda.
      CustomerSessionModel,
      CustomerDeviceLinkModel,
      DeviceSnapshotModel,
      CustomerLocationPingModel,
      CustomerDeviceContactModel,
    ]),
    CustomersModule,
    // La evaluación de riesgo consulta primero al motor de políticas versionadas; `risk_heuristic_v0`
    // pasa a ser el último recurso, que es el lugar que su propio autor le asignó.
    DecisionEngineModule,
  ],
  controllers: [RiskController, RiskReviewCallbackController],
  providers: [
    // AT-027: los hechos de entrada llegan por puerto; el adaptador local lee de la misma base.
    LocalRiskFraudFactsReader,
    LocalRiskInputFactsAdapter,
    { provide: RISK_INPUT_FACTS_PORT, useExisting: LocalRiskInputFactsAdapter },
    RiskRepository,
    RevisionManualRepository,
    RiskPolicyRepository,
    RiskPolicyDecisionService,
    RiskService,
    RiskManualReviewOutcomeService,
  ],
  exports: [RiskRepository, RiskService],
})
export class RiskModule {}
