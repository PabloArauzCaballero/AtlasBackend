/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza permite resolver excepciones y revisiones manuales con responsabilidad y trazabilidad.
 * @system gestiona colas y decisiones operativas mediante servicios transaccionales y repositorios aislados.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerObservationModel,
  CustomerStatusEventModel,
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
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      ManualReviewCaseModel,
      FraudCaseModel,
      ManualReviewEventModel,
      CustomerStatusEventModel,
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
  ],
  controllers: [OperationsController],
  providers: [OperationsRepository, OperationsService],
})
export class OperationsModule {}
