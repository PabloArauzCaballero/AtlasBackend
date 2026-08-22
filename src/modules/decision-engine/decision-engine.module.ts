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
  DecisionSubjectLinkModel,
  FeatureDefinitionModel,
  FeatureValueModel,
  IdentityVerificationAttemptModel,
  LoanInstallmentModel,
  LoanModel,
  LoanOutcomeReportModel,
} from '../../database/models/index.js';
import { CreditDecisionEngineService } from './credit-decision-engine.service.js';
import { DecisionEngineClient } from './decision-engine.client.js';
import { FeatureProjectionService } from './feature-projection.service.js';
import { OutcomeDispatchService } from './outcome-dispatch.service.js';
import { RiskDecisionEngineService } from './risk-decision-engine.service.js';
import { SubjectReferenceService } from './subject-reference.service.js';
import { UnderwritingFeaturesService } from './underwriting-features.service.js';

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
  providers: [
    DecisionEngineClient,
    FeatureProjectionService,
    UnderwritingFeaturesService,
    SubjectReferenceService,
    CreditDecisionEngineService,
    RiskDecisionEngineService,
    OutcomeDispatchService,
  ],
  exports: [CreditDecisionEngineService, UnderwritingFeaturesService, RiskDecisionEngineService, OutcomeDispatchService, SubjectReferenceService, DecisionEngineClient],
})
export class DecisionEngineModule {}
