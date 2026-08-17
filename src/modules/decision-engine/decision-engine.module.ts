/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza traslada la decisión de crédito a una política versionada, aprobada y auditable.
 * @system declara el límite de inyección de la integración con el motor de decisión.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  DecisionSubjectLinkModel,
  FeatureDefinitionModel,
  FeatureValueModel,
  LoanOutcomeReportModel,
} from '../../database/models/index.js';
import { CreditDecisionEngineService } from './credit-decision-engine.service.js';
import { DecisionEngineClient } from './decision-engine.client.js';
import { FeatureProjectionService } from './feature-projection.service.js';
import { OutcomeDispatchService } from './outcome-dispatch.service.js';
import { RiskDecisionEngineService } from './risk-decision-engine.service.js';
import { SubjectReferenceService } from './subject-reference.service.js';

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
  imports: [SequelizeModule.forFeature([DecisionSubjectLinkModel, FeatureDefinitionModel, FeatureValueModel, LoanOutcomeReportModel])],
  providers: [
    DecisionEngineClient,
    FeatureProjectionService,
    SubjectReferenceService,
    CreditDecisionEngineService,
    RiskDecisionEngineService,
    OutcomeDispatchService,
  ],
  exports: [CreditDecisionEngineService, RiskDecisionEngineService, OutcomeDispatchService, SubjectReferenceService, DecisionEngineClient],
})
export class DecisionEngineModule {}
