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
import { CustomerAddressPackageService } from './application/customer-address-package.service.js';
import { CustomerContactVerificationService } from './application/customer-contact-verification.service.js';
import { CustomerIdentityPackageService } from './application/customer-identity-package.service.js';
import { CustomerOnboardingStartService } from './application/customer-onboarding-start.service.js';
import { CustomerAddressStatusRepository } from './repositories/customer-address-status.repository.js';
import { CustomerContactVerificationRepository } from './repositories/customer-contact-verification.repository.js';
import { CustomerIdentityEvidenceRepository } from './repositories/customer-identity-evidence.repository.js';
import { CustomerOnboardingFlowRepository } from './repositories/customer-onboarding-flow.repository.js';
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
  providers: [
    CustomerOnboardingService,
    CustomerOnboardingStartService,
    CustomerContactVerificationService,
    CustomerIdentityPackageService,
    CustomerAddressPackageService,
    CustomerOnboardingFlowRepository,
    CustomerContactVerificationRepository,
    CustomerIdentityEvidenceRepository,
    CustomerAddressStatusRepository,
    CustomerOnboardingRepository,
  ],
})
export class CustomerOnboardingModule {}
