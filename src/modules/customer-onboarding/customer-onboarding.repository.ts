import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
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

type RepositoryOptions = {
  transaction?: Transaction;
};

@Injectable()
export class CustomerOnboardingRepository {
  constructor(
    @InjectModel(OnboardingFlowModel) private readonly onboardingFlowModel: typeof OnboardingFlowModel,
    @InjectModel(OnboardingStepEventModel) private readonly onboardingStepEventModel: typeof OnboardingStepEventModel,
    @InjectModel(PermissionEventModel) private readonly permissionEventModel: typeof PermissionEventModel,
    @InjectModel(CustomerActionLogModel) private readonly customerActionLogModel: typeof CustomerActionLogModel,
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
    @InjectModel(CustomerContactMethodModel) private readonly contactMethodModel: typeof CustomerContactMethodModel,
    @InjectModel(ContactVerificationAttemptModel)
    private readonly contactVerificationAttemptModel: typeof ContactVerificationAttemptModel,
    @InjectModel(AuthEventModel) private readonly authEventModel: typeof AuthEventModel,
    @InjectModel(CustomerIdentityDocumentModel)
    private readonly customerIdentityDocumentModel: typeof CustomerIdentityDocumentModel,
    @InjectModel(IdentityVerificationAttemptModel)
    private readonly identityVerificationAttemptModel: typeof IdentityVerificationAttemptModel,
    @InjectModel(EvidenceDocumentModel) private readonly evidenceDocumentModel: typeof EvidenceDocumentModel,
    @InjectModel(EvidenceExtractionModel) private readonly evidenceExtractionModel: typeof EvidenceExtractionModel,
    @InjectModel(EvidenceReviewModel) private readonly evidenceReviewModel: typeof EvidenceReviewModel,
    @InjectModel(DataProviderRequestModel) private readonly dataProviderRequestModel: typeof DataProviderRequestModel,
    @InjectModel(DataProviderResponseModel) private readonly dataProviderResponseModel: typeof DataProviderResponseModel,
    @InjectModel(CustomerAddressModel) private readonly customerAddressModel: typeof CustomerAddressModel,
    @InjectModel(CustomerAddressVersionModel) private readonly customerAddressVersionModel: typeof CustomerAddressVersionModel,
    @InjectModel(AddressGpsObservationModel) private readonly addressGpsObservationModel: typeof AddressGpsObservationModel,
    @InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel,
    @InjectModel(CustomerStatusEventModel) private readonly customerStatusEventModel: typeof CustomerStatusEventModel,
    @InjectModel(CustomerModel) private readonly customerModel: typeof CustomerModel,
  ) {}

  createOnboardingFlow(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      flowVersion: string;
      startedAt: Date;
      completionStatus: string;
    },
    options: RepositoryOptions,
  ): Promise<OnboardingFlowModel> {
    return this.onboardingFlowModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        flowVersion: values.flowVersion,
        startedAt: values.startedAt,
        completedAt: null,
        abandonedAt: null,
        completionStatus: values.completionStatus,
        totalDurationSeconds: null,
        createdAtValue: values.startedAt,
      },
      { transaction: options.transaction },
    );
  }

  findLatestOnboardingFlow(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<OnboardingFlowModel | null> {
    return this.onboardingFlowModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);
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
    return this.onboardingStepEventModel.create(
      {
        tenantId: values.tenantId,
        onboardingFlowId: values.onboardingFlowId,
        stepCode: values.stepCode,
        eventType: values.eventType,
        startedAt: values.happenedAt,
        endedAt: null,
        durationMs: null,
        errorCount: 0,
        payloadJson: values.payloadJson,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
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
    return this.permissionEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        onboardingFlowId: values.onboardingFlowId,
        permissionCode: values.permissionCode,
        requestedAt: values.decidedAt,
        granted: values.granted,
        respondedAt: values.decidedAt,
        createdAtValue: values.decidedAt,
      },
      { transaction: options.transaction },
    );
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
    return this.customerActionLogModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        eventName: values.eventName,
        screenName: values.screenName,
        actionPayloadJson: values.payloadJson,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
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
    return this.operationalAuditLogModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId ?? null,
        actorPlatformUserId: null,
        actionCode: values.actionCode,
        targetType: values.targetType,
        targetId: values.targetId,
        ipAddress: values.ipAddress,
        userAgent: values.userAgent,
        payloadJson: values.payloadJson,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  findCustomerContactMethod(
    tenantId: string,
    customerId: string,
    contactType: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerContactMethodModel | null> {
    return this.contactMethodModel.findOne({
      where: { tenantId, customerId, contactType, deleted: { [Op.ne]: true } },
      order: [
        ['isPrimary', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);
  }

  async markContactMethodVerified(
    contactMethod: CustomerContactMethodModel,
    verifiedAt: Date,
    options: RepositoryOptions,
  ): Promise<CustomerContactMethodModel> {
    contactMethod.status = 'verified';
    contactMethod.updatedAtValue = verifiedAt;
    return contactMethod.save({ transaction: options.transaction });
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
    return this.contactVerificationAttemptModel.create(
      {
        tenantId: values.tenantId,
        contactMethodId: values.contactMethodId,
        providerRequestId: null,
        verificationMethod: values.verificationMethod,
        verificationStatus: values.verificationStatus,
        confidenceScore: values.confidenceScore,
        attemptedAt: values.attemptedAt,
        verifiedAt: values.verifiedAt,
        failureReasonCode: values.failureReasonCode,
        createdAtValue: values.attemptedAt,
      },
      { transaction: options.transaction },
    );
  }

  findLatestContactVerificationAttempt(
    tenantId: string,
    contactMethodId: string,
    options: RepositoryOptions = {},
  ): Promise<ContactVerificationAttemptModel | null> {
    return this.contactVerificationAttemptModel.findOne({
      where: { tenantId, contactMethodId },
      order: [
        ['attemptedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);
  }

  async updateContactVerificationAttempt(
    attempt: ContactVerificationAttemptModel,
    values: { verificationStatus: string; verifiedAt: Date | null; failureReasonCode: string | null; confidenceScore: string | null },
    options: RepositoryOptions,
  ): Promise<ContactVerificationAttemptModel> {
    attempt.verificationStatus = values.verificationStatus;
    attempt.verifiedAt = values.verifiedAt;
    attempt.failureReasonCode = values.failureReasonCode;
    attempt.confidenceScore = values.confidenceScore;
    return attempt.save({ transaction: options.transaction });
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
    return this.authEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        eventType: values.eventType,
        loginSuccessful: values.loginSuccessful,
        failureReasonCode: values.failureReasonCode,
        occurredAt: values.occurredAt,
        ipAddress: values.ipAddress,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

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
    return this.evidenceDocumentModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        documentType: values.documentType,
        s3Bucket: null,
        s3Key: values.storageKey,
        fileHashSha256: values.sha256Hash,
        mimeType: values.mimeType,
        fileSizeBytes: values.fileSizeBytes,
        status: 'uploaded',
        uploadedAt: values.uploadedAt,
        uploadedFromIp: values.ipAddress,
        uploadedFromSessionId: values.sessionId,
        uploadedFromDeviceFingerprint: null,
        retentionPolicyId: null,
        expiresAt: null,
        retentionUntil: null,
        createdAtValue: values.uploadedAt,
        updatedAtValue: values.uploadedAt,
        deleted: false,
      },
      { transaction: options.transaction },
    );
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
    return this.evidenceExtractionModel.create(
      {
        tenantId: values.tenantId,
        evidenceDocumentId: values.evidenceDocumentId,
        extractionMethod: 'not_executed',
        extractionVersion: 'manual-v1',
        extractedDataJson: values.extractedDataJson,
        redactedExtractedDataJson: values.extractedDataJson,
        confidenceScore: null,
        extractedAt: values.extractedAt,
        processingDurationMs: null,
        requiresReview: values.requiresReview,
        createdAtValue: values.extractedAt,
      },
      { transaction: options.transaction },
    );
  }

  createEvidenceReview(
    values: {
      tenantId: string;
      evidenceDocumentId: string;
      reviewStatus: string;
      reviewedAt: Date;
      notes: string | null;
    },
    options: RepositoryOptions,
  ): Promise<EvidenceReviewModel> {
    return this.evidenceReviewModel.create(
      {
        tenantId: values.tenantId,
        evidenceDocumentId: values.evidenceDocumentId,
        reviewedBy: null,
        reviewStatus: values.reviewStatus,
        reviewedCorrectionsJson: null,
        rejectionReasonCode: null,
        reviewedAt: values.reviewedAt,
        notes: values.notes,
        createdAtValue: values.reviewedAt,
      },
      { transaction: options.transaction },
    );
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
    return this.customerIdentityDocumentModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        documentType: values.documentType,
        declaredNumberHash: values.numberHash,
        declaredNumberEncrypted: null,
        declaredNumberLast4: values.numberLast4,
        declaredComplement: null,
        declaredIssuedIn: values.issuedIn,
        ocrNumberHash: null,
        ocrFullName: null,
        ocrBirthDate: null,
        ocrConfidenceScore: null,
        verifiedNumberHash: null,
        issuedAt: values.issuedAt,
        expiresAt: values.expiresAt,
        frontEvidenceId: values.frontEvidenceId,
        backEvidenceId: values.backEvidenceId,
        verificationStatus: 'pending_review',
        verifiedAt: null,
        validFrom: values.createdAt,
        validUntil: null,
        createdAtValue: values.createdAt,
      },
      { transaction: options.transaction },
    );
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
    return this.identityVerificationAttemptModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        identityDocumentId: values.identityDocumentId,
        providerRequestId: values.providerRequestId,
        consentId: values.consentId,
        verificationChannel: values.verificationChannel,
        livenessScore: null,
        selfieMatchScore: null,
        documentForensicsScore: null,
        nameMatchScore: null,
        finalResult: values.finalResult,
        reasonCodesJson: values.reasonCodesJson,
        selfieEvidenceId: null,
        requestedAt: values.requestedAt,
        completedAt: null,
        manualReviewedBy: null,
        manualReviewNotes: null,
        createdAtValue: values.requestedAt,
      },
      { transaction: options.transaction },
    );
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
    return this.dataProviderRequestModel.create(
      {
        tenantId: values.tenantId,
        providerId: null,
        customerId: values.customerId,
        riskAssessmentRunId: null,
        consentId: null,
        requestType: values.requestType,
        providerRequestRef: values.providerRequestRef,
        requestPayloadHash: values.requestPayloadHash,
        idempotencyKey: values.idempotencyKey,
        responseStatus: 'not_sent',
        responseCode: null,
        latencyMs: null,
        requestedAt: values.requestedAt,
        respondedAt: null,
        createdAtValue: values.requestedAt,
      },
      { transaction: options.transaction },
    );
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
    return this.dataProviderResponseModel.create(
      {
        tenantId: values.tenantId,
        providerRequestId: values.providerRequestId,
        payloadStorageStrategy: 'redacted_json',
        responsePayloadJson: null,
        redactedPayloadJson: values.normalizedPayloadJson,
        rawPayloadS3Key: null,
        responseHash: values.responseHash,
        normalizedPayloadJson: values.normalizedPayloadJson,
        containsSensitiveData: false,
        retentionPolicyId: null,
        retentionUntil: null,
        createdAtValue: values.createdAt,
      },
      { transaction: options.transaction },
    );
  }

  findCurrentAddress(
    tenantId: string,
    customerId: string,
    addressType: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerAddressModel | null> {
    return this.customerAddressModel.findOne({
      where: { tenantId, customerId, addressType, deleted: { [Op.ne]: true } },
      order: [
        ['lastSeenAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);
  }

  createAddress(
    values: { tenantId: string; customerId: string; addressType: string; now: Date },
    options: RepositoryOptions,
  ): Promise<CustomerAddressModel> {
    return this.customerAddressModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        addressType: values.addressType,
        status: 'declared',
        currentVersionId: null,
        firstSeenAt: values.now,
        lastSeenAt: values.now,
        createdAtValue: values.now,
        updatedAtValue: values.now,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  async touchAddress(address: CustomerAddressModel, now: Date, options: RepositoryOptions): Promise<CustomerAddressModel> {
    address.lastSeenAt = now;
    address.updatedAtValue = now;
    return address.save({ transaction: options.transaction });
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
    return this.customerAddressVersionModel.create(
      {
        tenantId: values.tenantId,
        customerAddressId: values.customerAddressId,
        declaredAddressText: values.declaredAddressText,
        normalizedAddressText: values.normalizedAddressText,
        declaredZoneName: values.zone,
        city: values.city,
        department: values.department,
        countryCode: values.countryCode,
        geoZoneCodeSnapshot: null,
        geoZoneNameSnapshot: values.zone,
        evidenceId: null,
        sourceType: values.sourceType,
        verificationStatus: 'declared',
        verifiabilityBand: null,
        validFrom: values.validFrom,
        validUntil: null,
        supersedesVersionId: null,
        createdAtValue: values.validFrom,
      },
      { transaction: options.transaction },
    );
  }

  async updateAddressCurrentVersion(
    address: CustomerAddressModel,
    addressVersionId: string,
    now: Date,
    options: RepositoryOptions,
  ): Promise<CustomerAddressModel> {
    address.currentVersionId = addressVersionId;
    address.lastSeenAt = now;
    address.updatedAtValue = now;
    return address.save({ transaction: options.transaction });
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
    return this.addressGpsObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        customerAddressId: values.customerAddressId,
        addressVersionId: values.addressVersionId,
        sessionId: values.sessionId,
        gpsLat: values.gpsLat,
        gpsLng: values.gpsLng,
        gpsAccuracyMeters: values.gpsAccuracyMeters,
        matchScoreAgainstDeclaredAddress: null,
        distanceToDeclaredMeters: null,
        capturedAt: values.capturedAt,
        createdAtValue: values.capturedAt,
      },
      { transaction: options.transaction },
    );
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
    return this.customerObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        observationCode: values.observationCode,
        valueText: values.valueText,
        valueNumber: values.valueNumber,
        valueBoolean: values.valueBoolean,
        valueJson: values.valueJson,
        sourceType: 'api',
        sourceProviderId: null,
        evidenceId: null,
        confidenceScore: values.confidenceScore,
        verificationStatus: 'observed',
        capturedAt: values.observedAt,
        validFrom: values.observedAt,
        validUntil: null,
        derivationMethod: null,
        derivationVersion: null,
        createdAtValue: values.observedAt,
      },
      { transaction: options.transaction },
    );
  }

  async updateCustomerStatus(customer: CustomerModel, newStatus: string, now: Date, options: RepositoryOptions): Promise<CustomerModel> {
    customer.lifecycleStatus = newStatus;
    customer.updatedAtValue = now;
    return customer.save({ transaction: options.transaction });
  }
}
