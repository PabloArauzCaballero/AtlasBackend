/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { EDITABLE_ONBOARDING_STATUSES, normalizeLifecycleStatus } from '../../customers/customer-lifecycle.constants.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { IdentityPackageDto } from '../customer-onboarding.schemas.js';

@Injectable()
export class CustomerIdentityPackageService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    private readonly storageService: DocumentStorageService,
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

    const status = normalizeLifecycleStatus(customer.lifecycleStatus);
    if (!EDITABLE_ONBOARDING_STATUSES.includes(status)) {
      throw new UnprocessableEntityException(`PROFILE_NOT_EDITABLE_IN_STATUS: ${status}`);
    }

    const front = input.body.evidence.find((item) => item.evidenceType === 'identity_front');
    if (!front) throw new UnprocessableEntityException('REQUIRED_EVIDENCE_MISSING');

    // Verificación server-side ANTES de abrir la transacción. Hasta ahora el backend nunca veía el
    // archivo: guardaba la ruta y el hash que el propio cliente declaraba. Aquí se descarga cada
    // objeto, se recalcula el SHA-256, se contrasta el tamaño y se comprueban los bytes mágicos
    // contra el tipo declarado — renombrar un ejecutable a `.jpg` ya no alcanza.
    const verifiedEvidence = await this.verifyEvidenceObjects(input.body.evidence);

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
            bucket: this.storageService.getBucket(),
            mimeType: evidenceInput.mimeType,
            // Metadatos verificados contra el objeto real, no los declarados por el cliente.
            sha256Hash: verifiedEvidence.get(evidenceInput.storageKey)?.sha256Hex ?? evidenceInput.sha256Hash,
            fileSizeBytes: String(verifiedEvidence.get(evidenceInput.storageKey)?.sizeBytes ?? 0),
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
      // El estado y su evento de historial los escribe ahora `CustomerLifecycleService`, que valida
      // la transición y usa el estado anterior REAL. `pending_identity_review` era un estado que
      // este servicio escribía y que ningún otro componente leía; el destino canónico del avance de
      // onboarding es `onboarding_in_progress`, y a revisión se pasa al enviar el paquete completo.
      await this.lifecycleService.advance({
        tenantId: input.tenantId,
        customerId: input.customerId,
        toStatus: 'onboarding_in_progress',
        reasonCode: 'identity_package_submitted',
        changedByType: input.currentUser.role,
        changedByInternalUserId: input.currentUser.internalUserId ?? null,
        notes: 'Paquete KYC recibido.',
        transaction,
      });
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
        nextStep: 'reference_contacts',
      };
    });
  }

  /**
   * Descarga y valida cada objeto declarado. Falla el paquete completo ante el primer problema: una
   * evidencia que no se pudo verificar no es evidencia, y aceptar el resto dejaría un documento de
   * identidad a medio respaldar.
   */
  private async verifyEvidenceObjects(evidence: IdentityPackageDto['evidence']) {
    if (!this.storageService.isConfigured()) {
      throw new ServiceUnavailableException('DOCUMENT_STORAGE_NOT_CONFIGURED');
    }
    const verified = new Map<string, { sizeBytes: number; sha256Hex: string }>();
    for (const item of evidence) {
      const result = await this.storageService.verifyDeclaredObject({
        storageKey: item.storageKey,
        declaredSha256: item.sha256Hash,
        declaredMimeType: item.mimeType,
        declaredSizeBytes: item.fileSizeBytes ? Number(item.fileSizeBytes) : null,
      });
      if (!result.ok) {
        throw new UnprocessableEntityException(`${result.reason}: ${item.evidenceType}`);
      }
      verified.set(item.storageKey, { sizeBytes: result.metadata.sizeBytes, sha256Hex: result.metadata.sha256Hex });
    }
    return verified;
  }
}
