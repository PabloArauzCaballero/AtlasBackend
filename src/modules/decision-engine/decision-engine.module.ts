/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza traslada la decisión de crédito a una política versionada, aprobada y auditable.
 * @system declara el límite de inyección de la integración con el motor de decisión.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AttributeDefinitionModel,
  CustomerAddressModel,
  CustomerAttributeValueModel,
  CustomerContactMethodModel,
  CustomerProfileVersionModel,
  DecisionConsentReplicationModel,
  DecisionSubjectLinkModel,
  FeatureDefinitionModel,
  FeatureValueModel,
  IdentityVerificationAttemptModel,
  LoanInstallmentModel,
  LoanModel,
  LoanOutcomeReportModel,
} from '../../database/models/index.js';
import { CreditDecisionEngineService } from './credit-decision-engine.service.js';
import { DecisionArtifactBindingController } from './decision-artifact-binding.controller.js';
import { DecisionArtifactBindingService } from './decision-artifact-binding.service.js';
import { BankStatementEngineClient } from './bank-statement-engine.client.js';
import { DecisionEngineClient } from './decision-engine.client.js';
import { FeatureProjectionService } from './feature-projection.service.js';
import { OutcomeDispatchService } from './outcome-dispatch.service.js';
import { FacilityRegistrationService } from './facility-registration.service.js';
import { ConsentReplicationStore } from './consent-replication.store.js';
import { ConsentReplicationService } from './consent-replication.service.js';
import { PortfolioReconciliationService } from './portfolio-reconciliation.service.js';
import { EngineTransportService } from './engine-transport.service.js';
import { RiskDecisionEngineService } from './risk-decision-engine.service.js';
import { SubjectReferenceService } from './subject-reference.service.js';
import { UnderwritingFeaturesService } from './underwriting-features.service.js';
import { UnderwritingSignalsService } from './underwriting-signals.service.js';
import { UnderwritingCreditHistoryService } from './underwriting-credit-history.service.js';

/**
 * Integración con el ATLAS Decision Engine.
 *
 * Módulo propio y no una carpeta dentro de `credit` porque son dos sistemas distintos con su propio
 * ciclo de vida, y porque el motor decide más que crédito: el mismo cliente y el mismo puente de
 * features servirán para fraude y para las decisiones de ciclo de vida sin tener que desenredarlos
 * de un dominio concreto.
 *
 * `ResilientAdapterExecutorService` no se importa: `ResilienceModule` es `@Global()`.
 */
@Module({
  imports: [
    /*
     * Los modelos se inyectan DIRECTAMENTE en vez de importar los módulos de cliente y préstamos.
     * Esos módulos ya importan éste —son ellos los que deciden—, así que traerlos de vuelta cerraría
     * un ciclo. Aquí solo se LEE del expediente para componer las variables; ninguna regla de esos
     * dominios se reimplementa.
     */
    SequelizeModule.forFeature([
      DecisionSubjectLinkModel,
      // P-09: la cola duradera de réplica de consentimientos al motor.
      DecisionConsentReplicationModel,
      FeatureDefinitionModel,
      FeatureValueModel,
      LoanOutcomeReportModel,
      AttributeDefinitionModel,
      CustomerAttributeValueModel,
      CustomerProfileVersionModel,
      CustomerContactMethodModel,
      CustomerAddressModel,
      IdentityVerificationAttemptModel,
      LoanModel,
      LoanInstallmentModel,
    ]),
  ],
  controllers: [DecisionArtifactBindingController],
  providers: [
    DecisionEngineClient,
    BankStatementEngineClient,
    DecisionArtifactBindingService,
    FeatureProjectionService,
    UnderwritingFeaturesService,
    UnderwritingSignalsService,
    UnderwritingCreditHistoryService,
    SubjectReferenceService,
    CreditDecisionEngineService,
    RiskDecisionEngineService,
    OutcomeDispatchService,
    FacilityRegistrationService,
    EngineTransportService,
    ConsentReplicationStore,
    ConsentReplicationService,
    PortfolioReconciliationService,
  ],
  exports: [
    CreditDecisionEngineService,
    UnderwritingFeaturesService,
    RiskDecisionEngineService,
    OutcomeDispatchService,
    FacilityRegistrationService,
    PortfolioReconciliationService,
    SubjectReferenceService,
    DecisionEngineClient,
    // El worker de extractos del motor. Se exporta porque quien lo usa es el trabajo de fondo de
    // crédito: este backend ya no lee extractos, los manda a quien sabe leerlos.
    BankStatementEngineClient,
    DecisionArtifactBindingService,
  ],
})
export class DecisionEngineModule {}
