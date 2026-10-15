/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza permite resolver excepciones y revisiones manuales con responsabilidad y trazabilidad.
 * @system gestiona colas y decisiones operativas mediante servicios transaccionales y repositorios aislados.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerObservationModel,
  IdentityVerificationAttemptModel,
  DataChangeLogModel,
  FraudCaseModel,
  ManualReviewCaseModel,
  ManualReviewEventModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { RiskModule } from '../risk/risk.module.js';
import { FraudModule } from '../fraud/fraud.module.js';
import { CustomerOnboardingModule } from '../customer-onboarding/customer-onboarding.module.js';
import { CustomerTelemetryModule } from '../customer-telemetry/customer-telemetry.module.js';
import { OperationsController } from './operations.controller.js';
import { CustomerInvestigationRepository } from './customer-investigation.repository.js';
import { CustomerObservationRepository } from './customer-observation.repository.js';
import { ManualReviewCaseRepository } from './manual-review-case.repository.js';
import { ManualReviewDecisionService } from './manual-review-decision.service.js';
import { OperationsAuditRepository } from './operations-audit.repository.js';
import { OperationsInvestigationService } from './operations-investigation.service.js';
import { OperationsQueueRepository } from './operations-queue.repository.js';
import { OperationsWorkQueueService } from './operations-work-queue.service.js';
import { PendingContactVerificationService } from './pending-contact-verification.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      ManualReviewCaseModel,
      FraudCaseModel,
      ManualReviewEventModel,
      OperationalAuditLogModel,
      DataChangeLogModel,
      CustomerObservationModel,
      IdentityVerificationAttemptModel,
    ]),
    CustomersModule,
    RiskModule,
    FraudModule,
    // Por la agenda del cliente: la calcula y la guarda el módulo de alta.
    CustomerOnboardingModule,
    // Por el resumen de comportamiento del alta: lo calcula y lo guarda la telemetría.
    CustomerTelemetryModule,
  ],
  controllers: [OperationsController],
  providers: [
    ManualReviewCaseRepository,
    CustomerInvestigationRepository,
    CustomerObservationRepository,
    OperationsAuditRepository,
    OperationsQueueRepository,
    OperationsInvestigationService,
    ManualReviewDecisionService,
    OperationsWorkQueueService,
    PendingContactVerificationService,
  ],
})
export class OperationsModule {}
