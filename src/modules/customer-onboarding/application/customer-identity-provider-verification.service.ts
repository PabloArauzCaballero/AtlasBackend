/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { hashSensitiveText } from '../../../common/utils/crypto/hash.util.js';
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { ExternalDataService } from '../../external-data/external-data.service.js';
import { VerifyIdentityDto } from '../customer-onboarding-profile.schemas.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { CustomerProfileDataRepository } from '../repositories/customer-profile-data.repository.js';
import { CustomerVerificationRepository } from '../repositories/customer-verification.repository.js';
import { resolveIdentityOutcome } from './identity-verification-outcome.js';

/**
 * Verificación automática de identidad contra el proveedor externo (SEGIP).
 *
 * Cierra la condición C9 por la vía automática. Hasta ahora `identity_verification_attempts` se
 * creaba siempre en `pending_review` y el endpoint `POST /kyc/segip/verify` existía pero **su
 * resultado no llegaba a ninguna parte**: se guardaba en `data_provider_responses` y el expediente
 * del cliente seguía intacto. Este servicio es el puente que faltaba.
 *
 * El número de documento viaja en claro en la petición porque es lo que el registro estatal necesita
 * para responder, pero **no se persiste**: se usa para llamar al proveedor y para comprobar que
 * corresponde al documento ya declarado (por hash), y ahí termina su vida.
 */
@Injectable()
export class CustomerIdentityProviderVerificationService {
  private readonly logger = new Logger(CustomerIdentityProviderVerificationService.name);

  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly verificationRepository: CustomerVerificationRepository,
    private readonly profileDataRepository: CustomerProfileDataRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly externalDataService: ExternalDataService,
    private readonly lifecycleService: CustomerLifecycleService,
    private readonly eligibilityService: CustomerEligibilityService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async verifyWithProvider(input: {
    tenantId: string;
    customerId: string;
    body: VerifyIdentityDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const attempt = await this.verificationRepository.findLatestAttempt(input.tenantId, input.customerId);
    if (!attempt) throw new UnprocessableEntityException('IDENTITY_PACKAGE_REQUIRED');
    if (attempt.finalResult === 'verified') throw new UnprocessableEntityException('IDENTITY_ALREADY_VERIFIED');

    const document = await this.verificationRepository.findLatestIdentityDocument(input.tenantId, input.customerId);
    if (!document) throw new UnprocessableEntityException('IDENTITY_PACKAGE_REQUIRED');

    // El documento enviado debe ser el MISMO que se declaró en el paquete. Sin esta comprobación se
    // podría verificar la identidad de otra persona y adjuntarla al expediente del cliente.
    if (document.declaredNumberHash && hashSensitiveText(input.body.documentNumber) !== document.declaredNumberHash) {
      throw new UnprocessableEntityException('DOCUMENT_NUMBER_MISMATCH');
    }

    const profile = await this.profileDataRepository.findCurrentProfile(input.tenantId, input.customerId);
    if (!profile?.firstName || !profile.lastName) throw new UnprocessableEntityException('PROFILE_INCOMPLETE_FOR_VERIFICATION');

    const providerResult = await this.externalDataService.executeSegip({
      tenantId: input.tenantId,
      customerId: input.customerId,
      body: {
        documentNumber: input.body.documentNumber,
        documentComplement: input.body.documentComplement,
        firstName: profile.firstName,
        lastName: profile.lastName,
        birthDate: profile.birthDate ?? undefined,
        // Sin `scenario`: el veredicto lo decide el proveedor. Que el propio cliente pudiera pedirlo
        // convertía la verificación de identidad en una declaración jurada de sí misma.
      },
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.currentUser.internalUserId ?? input.currentUser.customerId,
    });

    const outcome = resolveIdentityOutcome({
      status: providerResult.status,
      manualReviewRequired: providerResult.manualReviewRequired,
      reasonCode: providerResult.reasonCode,
    });

    this.logger.log(
      `Verificación de identidad del cliente ${input.customerId}: proveedor=${providerResult.status} → ${outcome.finalResult} (${outcome.reasonCode}).`,
    );

    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      await this.verificationRepository.resolveAttempt(
        attempt,
        {
          finalResult: outcome.finalResult,
          // Es una resolución del proveedor, no de una persona: `manualReviewedBy` queda vacío.
          reviewedBy: null,
          notes: `Proveedor: ${providerResult.providerCode} · estado: ${providerResult.status} · motivo: ${outcome.reasonCode}`,
          now,
        },
        { transaction },
      );

      // El documento solo cambia de estado cuando hay un veredicto; una caída del proveedor lo deja
      // como estaba, para que un reintento posterior siga siendo posible.
      if (outcome.finalResult !== 'pending_review') {
        await this.verificationRepository.resolveIdentityDocument(
          input.tenantId,
          input.customerId,
          { verificationStatus: outcome.finalResult === 'verified' ? 'verified' : 'rejected', now },
          { transaction },
        );
      }

      if (outcome.resolvesEvidence) {
        const pending = await this.verificationRepository.findPendingReviews(input.tenantId, input.customerId, { transaction });
        for (const review of pending) {
          await this.verificationRepository.resolveReview(
            review,
            { reviewStatus: 'approved', reviewedBy: null, rejectionReasonCode: null, notes: outcome.reasonCode, now },
            { transaction },
          );
        }
      }

      if (outcome.finalResult === 'rejected') {
        await this.lifecycleService.advance({
          tenantId: input.tenantId,
          customerId: input.customerId,
          toStatus: 'observed',
          reasonCode: outcome.reasonCode,
          changedByType: 'system',
          changedByInternalUserId: null,
          notes: 'El registro externo no encontró el documento declarado.',
          transaction,
        });
      }

      const flow = await this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });
      await this.onboardingRepository.createOnboardingStepEvent(
        {
          tenantId: input.tenantId,
          onboardingFlowId: flow ? String(flow.id) : null,
          stepCode: 'identity_provider_verification',
          eventType: outcome.finalResult === 'verified' ? 'completed' : 'failed',
          happenedAt: now,
          payloadJson: {
            providerCode: providerResult.providerCode,
            providerStatus: providerResult.status,
            finalResult: outcome.finalResult,
            requestId: providerResult.requestId,
          },
        },
        { transaction },
      );

      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.identity_verification.provider',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          // El número de documento NO se audita: se usó para consultar y no se conserva.
          payloadJson: {
            providerCode: providerResult.providerCode,
            providerStatus: providerResult.status,
            providerRequestId: providerResult.requestId,
            finalResult: outcome.finalResult,
            reasonCode: outcome.reasonCode,
          },
          occurredAt: now,
        },
        { transaction },
      );

      const evaluation = await this.eligibilityService.evaluateAndRecord({
        tenantId: input.tenantId,
        customerId: input.customerId,
        evaluatedByType: input.currentUser.role,
        evaluatedByInternalUserId: input.currentUser.internalUserId ?? null,
        decisionSource: 'automatic',
        reasonCode: outcome.reasonCode,
        transaction,
      });

      return {
        customerId: input.customerId,
        providerCode: providerResult.providerCode,
        providerStatus: providerResult.status,
        providerRequestId: providerResult.requestId,
        identityVerificationResult: outcome.finalResult,
        requiresManualReview: outcome.requiresManualReview,
        reasonCode: outcome.reasonCode,
        lifecycleStatus: evaluation.lifecycleStatus,
        eligible: evaluation.eligible,
        blockers: evaluation.blockers,
        // Del evaluador y no de un literal: tras resolver la identidad, dónde retoma el cliente lo
        // decide el mismo cálculo que gobierna la habilitación.
        nextStep: evaluation.nextStep,
      };
    });
  }
}
