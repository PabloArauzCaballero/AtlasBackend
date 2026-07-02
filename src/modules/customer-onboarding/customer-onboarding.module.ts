import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AddressGpsObservationModel,
  AuthEventModel,
  ContactVerificationAttemptModel,
  CustomerActionLogModel,
  CustomerAddressModel,
  CustomerAddressVersionModel,
  CustomerContactMethodModel,
  CustomerIdentityDocumentModel,
  CustomerModel,
  CustomerObservationModel,
  CustomerStatusEventModel,
  DataProviderRequestModel,
  DataProviderResponseModel,
  EvidenceDocumentModel,
  EvidenceExtractionModel,
  EvidenceReviewModel,
  IdentityVerificationAttemptModel,
  OnboardingFlowModel,
  OnboardingStepEventModel,
  OperationalAuditLogModel,
  PermissionEventModel,
} from '../../database/models/index.js';
import { ConsentsModule } from '../consents/consents.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CustomerOnboardingController } from './customer-onboarding.controller.js';
import { CustomerOnboardingRepository } from './customer-onboarding.repository.js';
import { CustomerOnboardingService } from './customer-onboarding.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      OnboardingFlowModel,
      OnboardingStepEventModel,
      PermissionEventModel,
      CustomerActionLogModel,
      OperationalAuditLogModel,
      CustomerContactMethodModel,
      ContactVerificationAttemptModel,
      AuthEventModel,
      CustomerIdentityDocumentModel,
      IdentityVerificationAttemptModel,
      EvidenceDocumentModel,
      EvidenceExtractionModel,
      EvidenceReviewModel,
      DataProviderRequestModel,
      DataProviderResponseModel,
      CustomerAddressModel,
      CustomerAddressVersionModel,
      AddressGpsObservationModel,
      CustomerObservationModel,
      CustomerStatusEventModel,
      CustomerModel,
    ]),
    CustomersModule,
    SessionsModule,
    ConsentsModule,
    AuthModule,
  ],
  controllers: [CustomerOnboardingController],
  providers: [CustomerOnboardingService, CustomerOnboardingRepository],
})
export class CustomerOnboardingModule {}
