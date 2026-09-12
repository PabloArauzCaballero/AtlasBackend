/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { Module } from '@nestjs/common';
import { CustomerRecipientDirectoryAdapter } from './infrastructure/customer-recipient-directory.adapter.js';
import { CustomerRecipientDirectoryController } from './customer-recipient-directory.controller.js';
import { CustomerStateAdapter } from './infrastructure/customer-state.adapter.js';
import { CUSTOMER_STATE_PORT } from './application/ports/customer-state.port.js';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AttributeDefinitionModel,
  AuthCredentialModel,
  ConsentDocumentModel,
  CustomerAddressModel,
  CustomerAttributeValueModel,
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerEligibilityEvaluationModel,
  CustomerIdentityDocumentModel,
  CustomerModel,
  CustomerProfileVersionModel,
  CustomerReferenceContactModel,
  CustomerStatusEventModel,
  DataQualityIssueModel,
  EvidenceDocumentModel,
  EvidenceReviewModel,
  FraudCaseModel,
  IdentityVerificationAttemptModel,
  ManualReviewCaseModel,
  OnboardingFlowModel,
  OutboxEventModel,
  RiskAssessmentResultModel,
  WatchlistMatchModel,
} from '../../database/models/index.js';
import { CustomerEligibilityDecisionService } from './application/customer-eligibility-decision.service.js';
import { CustomerEligibilityService } from './application/customer-eligibility.service.js';
import { CustomerLifecycleService } from './application/customer-lifecycle.service.js';
import { CustomerEligibilityController } from './customer-eligibility.controller.js';
import { CustomersController } from './customers.controller.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomersService } from './customers.service.js';
import { CustomerEligibilityRepository } from './repositories/customer-eligibility.repository.js';
import { CustomerEligibilityRiskRepository } from './repositories/customer-eligibility-risk.repository.js';
import { CustomerContactsRepository } from './repositories/customer-contacts.repository.js';
import { CustomerLifecycleRepository } from './repositories/customer-lifecycle.repository.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      CustomerModel,
      CustomerProfileVersionModel,
      CustomerStatusEventModel,
      CustomerContactMethodModel,
      CustomerConsentModel,
      RiskAssessmentResultModel,
      CustomerEligibilityEvaluationModel,
      AuthCredentialModel,
      AttributeDefinitionModel,
      CustomerAttributeValueModel,
      CustomerAddressModel,
      CustomerReferenceContactModel,
      CustomerIdentityDocumentModel,
      IdentityVerificationAttemptModel,
      EvidenceDocumentModel,
      EvidenceReviewModel,
      ConsentDocumentModel,
      DataQualityIssueModel,
      ManualReviewCaseModel,
      WatchlistMatchModel,
      OnboardingFlowModel,
      OutboxEventModel,
      OutboxEventModel,
      FraudCaseModel,
    ]),
  ],
  controllers: [CustomersController, CustomerEligibilityController, CustomerRecipientDirectoryController],
  providers: [
    // AT-020: Clientes implementa el directorio de destinatarios que Mensajería consume por puerto.
    CustomerRecipientDirectoryAdapter,
    CustomerStateAdapter,
    { provide: CUSTOMER_STATE_PORT, useExisting: CustomerStateAdapter },
    CustomersService,
    CustomersRepository,
    CustomerLifecycleService,
    CustomerLifecycleRepository,
    CustomerEligibilityService,
    CustomerEligibilityRepository,
    CustomerEligibilityRiskRepository,
    CustomerContactsRepository,
    CustomerEligibilityDecisionService,
  ],
  exports: [
    CUSTOMER_STATE_PORT,
    CustomerRecipientDirectoryAdapter,
    CustomersService,
    CustomersRepository,
    CustomerLifecycleService,
    CustomerEligibilityService,
    CustomerEligibilityRepository,
    CustomerEligibilityRiskRepository,
    CustomerContactsRepository,
  ],
})
export class CustomersModule {}
