/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { BadRequestException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { ExpedienteHooksService } from '../../expedientes/application/expediente-hooks.service.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { EDITABLE_ONBOARDING_STATUSES, normalizeLifecycleStatus } from '../../customers/customer-lifecycle.constants.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { CustomerIdentityProviderVerificationService } from './customer-identity-provider-verification.service.js';
import { IdentityEvidenceVerificationService } from './identity-evidence-verification.service.js';
import { IdentityPackageDto } from '../customer-onboarding.schemas.js';

@Injectable()
export class CustomerIdentityPackageService {
  private readonly logger = new Logger(CustomerIdentityPackageService.name);

  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    private readonly storageService: DocumentStorageService,
    private readonly providerVerificationService: CustomerIdentityProviderVerificationService,
    private readonly eligibilityService: CustomerEligibilityService,
    private readonly evidenceVerification: IdentityEvidenceVerificationService,
    private readonly expedienteHooks: ExpedienteHooksService,
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
    // El prefijo es el mismo que impone el ticket de subida (`DocumentStorageService`): tenant y
    // cliente. Sin esta comprobación el paquete aceptaba cualquier ruta, incluida la de la evidencia
    // de otro cliente del mismo bucket — bastaba conocerla para adjuntarla al expediente propio.
    this.evidenceVerification.assertBelongsToCustomer(input.tenantId, input.customerId, input.body.evidence);

    const verifiedEvidence = await this.evidenceVerification.verifyObjects(input.body.evidence);

    const now = new Date();

    const packageResult = await this.sequelize.transaction(async (transaction) => {
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

      // `nextStep` del evaluador, no del literal `reference_contacts` que este servicio devolvía:
      // el catálogo de secciones y su orden viven en un solo sitio.
      const assessment = await this.eligibilityService.evaluate(input.tenantId, input.customerId, transaction);

      return {
        customerId: input.customerId,
        identityVerificationAttemptId: String(attempt.id),
        status: 'pending_review',
        nextStep: assessment.nextStep,
      };
    });

    /*
     * El expediente se actualiza FUERA de la transacción y sin poder tumbarla.
     *
     * Los documentos ya quedaron guardados en `evidence_documents` y en el almacén; lo que se hace
     * aquí es colocarlos en la carpeta que un revisor va a abrir. Dentro de la transacción, un
     * fallo del catálogo habría deshecho un paquete KYC completo por un problema de presentación.
     */
    for (const evidencia of input.body.evidence) {
      const verificada = verifiedEvidence.get(evidencia.storageKey);
      await this.expedienteHooks.alRegistrarEvidencia({
        tenantId: input.tenantId,
        customerId: input.customerId,
        documentType: evidencia.evidenceType,
        evidenceDocumentId: null,
        storageKey: evidencia.storageKey,
        storageBucket: this.storageService.getBucket(),
        sha256: verificada?.sha256Hex ?? evidencia.sha256Hash,
        mimeType: evidencia.mimeType,
        sizeBytes: String(verificada?.sizeBytes ?? 0),
      });
    }

    // Encadenamiento OPCIONAL de la verificación externa, fuera de la transacción a propósito: una
    // llamada HTTP a un proveedor dentro de una transacción mantendría locks abiertos durante toda
    // su latencia. Si el proveedor falla, el paquete ya quedó guardado y la verificación puede
    // reintentarse por su endpoint dedicado — perder el paquete por una caída ajena sería peor.
    if (!input.body.identity.documentNumber) return packageResult;

    try {
      const verification = await this.providerVerificationService.verifyWithProvider({
        tenantId: input.tenantId,
        customerId: input.customerId,
        body: { documentNumber: input.body.identity.documentNumber },
        currentUser: input.currentUser,
        ipAddress: input.ipAddress,
        idempotencyKey: `${input.idempotencyKey}:identity-verification`,
      });
      return {
        ...packageResult,
        status: verification.identityVerificationResult,
        verification: {
          providerStatus: verification.providerStatus,
          identityVerificationResult: verification.identityVerificationResult,
          requiresManualReview: verification.requiresManualReview,
          reasonCode: verification.reasonCode,
        },
        // También del evaluador: tras la verificación externa el estado cambió, así que el paso
        // siguiente lo dice la evaluación que esa misma operación acaba de registrar.
        nextStep: verification.nextStep,
      };
    } catch (error) {
      this.logger.warn(
        `Paquete de identidad guardado, pero la verificación encadenada del cliente ${input.customerId} falló: ${
          error instanceof Error ? error.message : 'error desconocido'
        }. Queda disponible el endpoint dedicado.`,
      );
      return { ...packageResult, verification: { skipped: true, reason: 'VERIFICATION_DEFERRED' } };
    }
  }
}
