import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { IdentityPackageDto } from '../customer-onboarding.schemas.js';

@Injectable()
export class CustomerIdentityPackageService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async submitIdentityPackage(input: {
    tenantId: string;
    customerId: string;
    body: IdentityPackageDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const front = input.body.evidence.find((item) => item.evidenceType === 'identity_front');
    if (!front) throw new UnprocessableEntityException('REQUIRED_EVIDENCE_MISSING');
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      let providerRequestId: string | null = null;
      if (input.body.provider) {
        const providerRequest = await this.onboardingRepository.createDataProviderRequest(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            requestType: 'identity_verification',
            providerRequestRef: input.body.provider.providerCode,
            requestPayloadHash: input.body.provider.requestPayloadHash ?? null,
            idempotencyKey: input.idempotencyKey,
            requestedAt: now,
          },
          { transaction },
        );
        providerRequestId = String(providerRequest.id);
        await this.onboardingRepository.createDataProviderResponse(
          {
            tenantId: input.tenantId,
            providerRequestId,
            responseHash: sha256Hex(`${providerRequestId}:pending`),
            normalizedPayloadJson: { status: 'pending_manual_or_external_verification' },
            createdAt: now,
          },
          { transaction },
        );
      }

      const evidenceIds: Record<string, string> = {};
      for (const evidenceInput of input.body.evidence) {
        const evidence = await this.onboardingRepository.createEvidenceDocument(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            documentType: evidenceInput.evidenceType,
            storageKey: evidenceInput.storageKey,
            mimeType: evidenceInput.mimeType,
            sha256Hash: evidenceInput.sha256Hash,
            fileSizeBytes: evidenceInput.fileSizeBytes ?? null,
            sessionId: input.body.sessionId ?? null,
            ipAddress: input.ipAddress,
            uploadedAt: now,
          },
          { transaction },
        );
        evidenceIds[evidenceInput.evidenceType] = String(evidence.id);
        await this.onboardingRepository.createEvidenceExtraction(
          {
            tenantId: input.tenantId,
            evidenceDocumentId: String(evidence.id),
            extractedAt: now,
            requiresReview: true,
            extractedDataJson: { extractionStatus: 'not_executed' },
          },
          { transaction },
        );
        await this.onboardingRepository.createEvidenceReview(
          {
            tenantId: input.tenantId,
            evidenceDocumentId: String(evidence.id),
            reviewStatus: 'pending_review',
            reviewedAt: now,
            notes: 'Evidencia recibida durante identity-package.',
          },
          { transaction },
        );
      }

      const identityDocument = await this.onboardingRepository.createIdentityDocument(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          documentType: input.body.identity.documentType,
          numberHash: input.body.identity.documentNumberHash,
          numberLast4: input.body.identity.documentLast4,
          issuedIn: input.body.identity.issuedIn ?? null,
          issuedAt: input.body.identity.issuedAt ?? null,
          expiresAt: input.body.identity.expiresAt ?? null,
          frontEvidenceId: evidenceIds.identity_front ?? null,
          backEvidenceId: evidenceIds.identity_back ?? null,
          createdAt: now,
        },
        { transaction },
      );

      const attempt = await this.onboardingRepository.createIdentityVerificationAttempt(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          identityDocumentId: String(identityDocument.id),
          providerRequestId,
          consentId: null,
          verificationChannel: 'onboarding_package',
          finalResult: 'pending_review',
          reasonCodesJson: { reasonCodes: ['identity_evidence_pending_review'] },
          requestedAt: now,
        },
        { transaction },
      );

      const flow = await this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });
      await this.onboardingRepository.createOnboardingStepEvent(
        {
          tenantId: input.tenantId,
          onboardingFlowId: flow ? String(flow.id) : null,
          stepCode: 'identity_package_submitted',
          eventType: 'completed',
          happenedAt: now,
          payloadJson: { evidenceCount: input.body.evidence.length, identityDocumentId: String(identityDocument.id) },
        },
        { transaction },
      );
      await this.customersRepository.createStatusEvent(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          previousStatus: customer.lifecycleStatus,
          newStatus: 'pending_identity_review',
          reasonCode: 'identity_package_submitted',
          changedByType: input.currentUser.role,
          happenedAt: now,
          notes: 'Paquete KYC recibido.',
        },
        { transaction },
      );
      await this.onboardingRepository.updateCustomerStatus(customer, 'pending_identity_review', now, { transaction });
      await this.onboardingRepository.createCustomerActionLog(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: input.body.sessionId ?? null,
          deviceId: null,
          eventName: 'identity_package_submitted',
          screenName: 'identity_capture',
          payloadJson: { idempotencyKeyHash: sha256Hex(input.idempotencyKey), evidenceCount: input.body.evidence.length },
          occurredAt: now,
        },
        { transaction },
      );
      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.identity_package',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: { identityDocumentId: String(identityDocument.id), verificationAttemptId: String(attempt.id) },
          occurredAt: now,
        },
        { transaction },
      );

      return {
        customerId: input.customerId,
        identityVerificationAttemptId: String(attempt.id),
        status: 'pending_review',
        nextStep: 'risk_evaluation',
      };
    });
  }
}
