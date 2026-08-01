/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AddressGpsObservationModel,
  AttributeDefinitionModel,
  AuthEventModel,
  ContactVerificationAttemptModel,
  CustomerActionLogModel,
  CustomerAddressModel,
  CustomerAddressVersionModel,
  CustomerAttributeValueModel,
  CustomerContactMethodModel,
  CustomerIdentityDocumentModel,
  CustomerModel,
  CustomerObservationModel,
  CustomerProfileVersionModel,
  CustomerReferenceContactModel,
  WatchlistEntryModel,
  WatchlistMatchModel,
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
import { MailSenderModule } from '../mail-sender/mail-sender.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CustomerOnboardingController } from './customer-onboarding.controller.js';
import { CustomerOnboardingProfileController } from './customer-onboarding-profile.controller.js';
import { CustomerOnboardingStatusController } from './customer-onboarding-status.controller.js';
import { CustomerVerificationController } from './customer-verification.controller.js';
import { CustomerAddressPackageService } from './application/customer-address-package.service.js';
import { DocumentStorageService } from '../../common/storage/document-storage.service.js';
import { MalwareScannerService } from '../../common/storage/malware-scanner.service.js';
import { CustomerDocumentUploadService } from './application/customer-document-upload.service.js';
import { CustomerIdentityProviderVerificationService } from './application/customer-identity-provider-verification.service.js';
import { ExternalDataModule } from '../external-data/external-data.module.js';
import { ContactVerificationCodeService } from './application/contact-verification-code.service.js';
import { ContactVerificationJournalService } from './application/contact-verification-journal.service.js';
import { CustomerContactVerificationService } from './application/customer-contact-verification.service.js';
import { CustomerIdentityPackageService } from './application/customer-identity-package.service.js';
import { CustomerOnboardingGuardsService } from './application/customer-onboarding-guards.service.js';
import { CustomerOnboardingStartService } from './application/customer-onboarding-start.service.js';
import { CustomerOnboardingStatusService } from './application/customer-onboarding-status.service.js';
import { CustomerProfileUpdateService } from './application/customer-profile-update.service.js';
import { CustomerFinancialProfileService } from './application/customer-financial-profile.service.js';
import { CustomerReferenceContactsService } from './application/customer-reference-contacts.service.js';
import { CustomerContactMethodsService } from './application/customer-contact-methods.service.js';
import { CustomerProfileDataRepository } from './repositories/customer-profile-data.repository.js';
import { CustomerVerificationRepository } from './repositories/customer-verification.repository.js';
import { OnboardingAbandonmentService } from './application/onboarding-abandonment.service.js';
import { CustomerVerificationService } from './application/customer-verification.service.js';
import { CustomerComplianceScreeningService } from './application/customer-compliance-screening.service.js';
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
      CustomerProfileVersionModel,
      CustomerAttributeValueModel,
      AttributeDefinitionModel,
      CustomerReferenceContactModel,
      WatchlistEntryModel,
      WatchlistMatchModel,
      WatchlistEntryModel,
      WatchlistMatchModel,
    ]),
    CustomersModule,
    SessionsModule,
    ConsentsModule,
    AuthModule,
    MailSenderModule,
    NotificationsModule,
    ExternalDataModule,
  ],
  controllers: [
    CustomerOnboardingController,
    CustomerOnboardingProfileController,
    CustomerOnboardingStatusController,
    CustomerVerificationController,
  ],
  providers: [
    CustomerOnboardingService,
    CustomerOnboardingStartService,
    CustomerOnboardingGuardsService,
    CustomerContactVerificationService,
    ContactVerificationCodeService,
    CustomerDocumentUploadService,
    CustomerIdentityProviderVerificationService,
    DocumentStorageService,
    MalwareScannerService,
    ContactVerificationJournalService,
    CustomerIdentityPackageService,
    CustomerAddressPackageService,
    CustomerOnboardingStatusService,
    CustomerProfileUpdateService,
    CustomerFinancialProfileService,
    CustomerReferenceContactsService,
    CustomerContactMethodsService,
    CustomerProfileDataRepository,
    CustomerVerificationRepository,
    OnboardingAbandonmentService,
    CustomerVerificationService,
    CustomerComplianceScreeningService,
    CustomerOnboardingFlowRepository,
    CustomerContactVerificationRepository,
    CustomerIdentityEvidenceRepository,
    CustomerAddressStatusRepository,
    CustomerOnboardingRepository,
  ],
})
export class CustomerOnboardingModule {}
