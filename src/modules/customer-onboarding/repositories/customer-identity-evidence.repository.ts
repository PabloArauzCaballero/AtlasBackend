import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import {
  CustomerIdentityDocumentModel,
  DataProviderRequestModel,
  DataProviderResponseModel,
  EvidenceDocumentModel,
  EvidenceExtractionModel,
  EvidenceReviewModel,
  IdentityVerificationAttemptModel,
} from '../../../database/models/index.js';

export type RepositoryOptions = {
  transaction?: Transaction;
};

/**
 * ATLAS-P11-T12: parte de la descomposición de `customer-onboarding.repository.ts`.
 * Responsabilidad única: documento de identidad declarado, evidencia (documentos/extracción/
 * revisión) y las llamadas/respuestas a proveedores externos de verificación. Split mecánico,
 * sin cambio de comportamiento.
 */
@Injectable()
export class CustomerIdentityEvidenceRepository {
  constructor(
    @InjectModel(CustomerIdentityDocumentModel)
    private readonly customerIdentityDocumentModel: typeof CustomerIdentityDocumentModel,
    @InjectModel(IdentityVerificationAttemptModel)
    private readonly identityVerificationAttemptModel: typeof IdentityVerificationAttemptModel,
    @InjectModel(EvidenceDocumentModel) private readonly evidenceDocumentModel: typeof EvidenceDocumentModel,
    @InjectModel(EvidenceExtractionModel) private readonly evidenceExtractionModel: typeof EvidenceExtractionModel,
    @InjectModel(EvidenceReviewModel) private readonly evidenceReviewModel: typeof EvidenceReviewModel,
    @InjectModel(DataProviderRequestModel) private readonly dataProviderRequestModel: typeof DataProviderRequestModel,
    @InjectModel(DataProviderResponseModel) private readonly dataProviderResponseModel: typeof DataProviderResponseModel,
  ) {}

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
    values: { tenantId: string; evidenceDocumentId: string; reviewStatus: string; reviewedAt: Date; notes: string | null },
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
        payloadStorageStrategy: 'inline_redacted',
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
}
