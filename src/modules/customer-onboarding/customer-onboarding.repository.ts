import { Injectable } from '@nestjs/common';
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
import { CustomerAddressStatusRepository } from './repositories/customer-address-status.repository.js';
import { CustomerContactVerificationRepository } from './repositories/customer-contact-verification.repository.js';
import { CustomerIdentityEvidenceRepository } from './repositories/customer-identity-evidence.repository.js';
import { CustomerOnboardingFlowRepository, RepositoryOptions } from './repositories/customer-onboarding-flow.repository.js';

export type { RepositoryOptions } from './repositories/customer-onboarding-flow.repository.js';

/**
 * ATLAS-P11-T12 (cierra ATLAS-P11-013 / hallazgo de la revisión de calidad post-Fase 4):
 * `CustomerOnboardingRepository` era un único archivo de 751 líneas con 20 modelos Sequelize
 * inyectados, mezclando 4 responsabilidades distintas (flujo/auditoría de onboarding, contacto
 * y su verificación, identidad/evidencia + proveedores externos, dirección/GPS/estado del
 * cliente).
 *
 * Este archivo es ahora una fachada delgada: NINGÚN método público cambió de firma ni de
 * comportamiento respecto a la versión anterior. `CustomerOnboardingService` y los servicios de
 * aplicación que dependen de este repositorio no requieren ningún cambio.
 */
@Injectable()
export class CustomerOnboardingRepository {
  constructor(
    private readonly flowRepository: CustomerOnboardingFlowRepository,
    private readonly contactVerificationRepository: CustomerContactVerificationRepository,
    private readonly identityEvidenceRepository: CustomerIdentityEvidenceRepository,
    private readonly addressStatusRepository: CustomerAddressStatusRepository,
  ) {}

  // ---- Flujo de onboarding / auditoría (delega en CustomerOnboardingFlowRepository) ----

  createOnboardingFlow(
    values: { tenantId: string; customerId: string; sessionId: string; flowVersion: string; startedAt: Date; completionStatus: string },
    options: RepositoryOptions,
  ): Promise<OnboardingFlowModel> {
    return this.flowRepository.createOnboardingFlow(values, options);
  }

  findLatestOnboardingFlow(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<OnboardingFlowModel | null> {
    return this.flowRepository.findLatestOnboardingFlow(tenantId, customerId, options);
  }

  createOnboardingStepEvent(
    values: {
      tenantId: string;
      onboardingFlowId: string | null;
      stepCode: string;
      eventType: string;
      happenedAt: Date;
      payloadJson: Record<string, unknown> | null;
    },
    options: RepositoryOptions,
  ): Promise<OnboardingStepEventModel> {
    return this.flowRepository.createOnboardingStepEvent(values, options);
  }

  createPermissionEvent(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string | null;
      onboardingFlowId: string | null;
      permissionCode: string;
      granted: boolean;
      decidedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<PermissionEventModel> {
    return this.flowRepository.createPermissionEvent(values, options);
  }

  createCustomerActionLog(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string | null;
      deviceId: string | null;
      eventName: string;
      screenName: string | null;
      payloadJson: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerActionLogModel> {
    return this.flowRepository.createCustomerActionLog(values, options);
  }

  createOperationalAuditLog(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId?: string | null;
      actionCode: string;
      targetType: string;
      targetId: string;
      ipAddress: string | null;
      userAgent: string | null;
      payloadJson: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OperationalAuditLogModel> {
    return this.flowRepository.createOperationalAuditLog(values, options);
  }

  createAuthEvent(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string | null;
      deviceId: string | null;
      eventType: string;
      loginSuccessful: boolean | null;
      failureReasonCode: string | null;
      occurredAt: Date;
      ipAddress: string | null;
    },
    options: RepositoryOptions,
  ): Promise<AuthEventModel> {
    return this.flowRepository.createAuthEvent(values, options);
  }

  // ---- Contacto y verificación (delega en CustomerContactVerificationRepository) ----

  findCustomerContactMethod(
    tenantId: string,
    customerId: string,
    contactType: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerContactMethodModel | null> {
    return this.contactVerificationRepository.findCustomerContactMethod(tenantId, customerId, contactType, options);
  }

  markContactMethodVerified(
    contactMethod: CustomerContactMethodModel,
    verifiedAt: Date,
    options: RepositoryOptions,
  ): Promise<CustomerContactMethodModel> {
    return this.contactVerificationRepository.markContactMethodVerified(contactMethod, verifiedAt, options);
  }

  createContactVerificationAttempt(
    values: {
      tenantId: string;
      contactMethodId: string;
      verificationMethod: string;
      verificationStatus: string;
      confidenceScore: string | null;
      attemptedAt: Date;
      verifiedAt: Date | null;
      failureReasonCode: string | null;
    },
    options: RepositoryOptions,
  ): Promise<ContactVerificationAttemptModel> {
    return this.contactVerificationRepository.createContactVerificationAttempt(values, options);
  }

  findLatestContactVerificationAttempt(
    tenantId: string,
    contactMethodId: string,
    options: RepositoryOptions = {},
  ): Promise<ContactVerificationAttemptModel | null> {
    return this.contactVerificationRepository.findLatestContactVerificationAttempt(tenantId, contactMethodId, options);
  }

  updateContactVerificationAttempt(
    attempt: ContactVerificationAttemptModel,
    values: { verificationStatus: string; verifiedAt: Date | null; failureReasonCode: string | null; confidenceScore: string | null },
    options: RepositoryOptions,
  ): Promise<ContactVerificationAttemptModel> {
    return this.contactVerificationRepository.updateContactVerificationAttempt(attempt, values, options);
  }

  // ---- Identidad y evidencia (delega en CustomerIdentityEvidenceRepository) ----

  createEvidenceDocument(
    values: {
      tenantId: string;
      customerId: string;
      documentType: string;
      storageKey: string;
      mimeType: string;
      sha256Hash: string;
      fileSizeBytes: string | null;
      sessionId: string | null;
      ipAddress: string | null;
      uploadedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<EvidenceDocumentModel> {
    return this.identityEvidenceRepository.createEvidenceDocument(values, options);
  }

  createEvidenceExtraction(
    values: {
      tenantId: string;
      evidenceDocumentId: string;
      extractedAt: Date;
      requiresReview: boolean;
      extractedDataJson: Record<string, unknown> | null;
    },
    options: RepositoryOptions,
  ): Promise<EvidenceExtractionModel> {
    return this.identityEvidenceRepository.createEvidenceExtraction(values, options);
  }

  createEvidenceReview(
    values: { tenantId: string; evidenceDocumentId: string; reviewStatus: string; reviewedAt: Date; notes: string | null },
    options: RepositoryOptions,
  ): Promise<EvidenceReviewModel> {
    return this.identityEvidenceRepository.createEvidenceReview(values, options);
  }

  createIdentityDocument(
    values: {
      tenantId: string;
      customerId: string;
      documentType: string;
      numberHash: string;
      numberLast4: string;
      issuedIn: string | null;
      issuedAt: string | null;
      expiresAt: string | null;
      frontEvidenceId: string | null;
      backEvidenceId: string | null;
      createdAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerIdentityDocumentModel> {
    return this.identityEvidenceRepository.createIdentityDocument(values, options);
  }

  createIdentityVerificationAttempt(
    values: {
      tenantId: string;
      customerId: string;
      identityDocumentId: string;
      providerRequestId: string | null;
      consentId: string | null;
      verificationChannel: string;
      finalResult: string;
      reasonCodesJson: Record<string, unknown> | null;
      requestedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<IdentityVerificationAttemptModel> {
    return this.identityEvidenceRepository.createIdentityVerificationAttempt(values, options);
  }

  createDataProviderRequest(
    values: {
      tenantId: string;
      customerId: string;
      requestType: string;
      providerRequestRef: string | null;
      requestPayloadHash: string | null;
      idempotencyKey: string | null;
      requestedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<DataProviderRequestModel> {
    return this.identityEvidenceRepository.createDataProviderRequest(values, options);
  }

  createDataProviderResponse(
    values: {
      tenantId: string;
      providerRequestId: string;
      responseHash: string;
      normalizedPayloadJson: Record<string, unknown> | null;
      createdAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<DataProviderResponseModel> {
    return this.identityEvidenceRepository.createDataProviderResponse(values, options);
  }

  // ---- Dirección / observaciones / estado del cliente (delega en CustomerAddressStatusRepository) ----

  findCurrentAddress(
    tenantId: string,
    customerId: string,
    addressType: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerAddressModel | null> {
    return this.addressStatusRepository.findCurrentAddress(tenantId, customerId, addressType, options);
  }

  createAddress(
    values: { tenantId: string; customerId: string; addressType: string; now: Date },
    options: RepositoryOptions,
  ): Promise<CustomerAddressModel> {
    return this.addressStatusRepository.createAddress(values, options);
  }

  touchAddress(address: CustomerAddressModel, now: Date, options: RepositoryOptions): Promise<CustomerAddressModel> {
    return this.addressStatusRepository.touchAddress(address, now, options);
  }

  createAddressVersion(
    values: {
      tenantId: string;
      customerAddressId: string;
      declaredAddressText: string | null;
      normalizedAddressText: string | null;
      zone: string | null;
      city: string;
      department: string;
      countryCode: string;
      sourceType: string;
      validFrom: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerAddressVersionModel> {
    return this.addressStatusRepository.createAddressVersion(values, options);
  }

  updateAddressCurrentVersion(
    address: CustomerAddressModel,
    addressVersionId: string,
    now: Date,
    options: RepositoryOptions,
  ): Promise<CustomerAddressModel> {
    return this.addressStatusRepository.updateAddressCurrentVersion(address, addressVersionId, now, options);
  }

  createGpsObservation(
    values: {
      tenantId: string;
      customerId: string;
      customerAddressId: string;
      addressVersionId: string;
      sessionId: string | null;
      gpsLat: string;
      gpsLng: string;
      gpsAccuracyMeters: string | null;
      capturedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<AddressGpsObservationModel> {
    return this.addressStatusRepository.createGpsObservation(values, options);
  }

  createCustomerObservation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string | null;
      deviceId: string | null;
      observationCode: string;
      valueText: string | null;
      valueNumber: string | null;
      valueBoolean: boolean | null;
      valueJson: Record<string, unknown> | null;
      confidenceScore: string | null;
      observedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerObservationModel> {
    return this.addressStatusRepository.createCustomerObservation(values, options);
  }

  updateCustomerStatus(customer: CustomerModel, newStatus: string, now: Date, options: RepositoryOptions): Promise<CustomerModel> {
    return this.addressStatusRepository.updateCustomerStatus(customer, newStatus, now, options);
  }
}
