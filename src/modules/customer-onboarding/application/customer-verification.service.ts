/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { IdentityDecisionDto } from '../customer-onboarding-profile.schemas.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { CustomerVerificationRepository } from '../repositories/customer-verification.repository.js';

/**
 * Resolución de la verificación de identidad y de la revisión documental (C9 y C10).
 *
 * Era el techo real del flujo: `identity_verification_attempts` e `evidence_reviews` se creaban en
 * `pending_review` y NO existía ningún camino para resolverlas, así que ningún cliente podía llegar
 * nunca a ser elegible por más completo que estuviera su expediente.
 *
 * La resolución se hace en bloque —identidad, documento y todas sus evidencias— porque son una sola
 * decisión de negocio: un analista aprueba o rechaza un expediente, no piezas sueltas.
 */
@Injectable()
export class CustomerVerificationService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly verificationRepository: CustomerVerificationRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    private readonly eligibilityService: CustomerEligibilityService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async decideIdentity(input: {
    tenantId: string;
    customerId: string;
    body: IdentityDecisionDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }) {
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const approved = input.body.decision === 'approve';
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      const attempt = await this.verificationRepository.findLatestAttempt(input.tenantId, input.customerId, { transaction });
      if (!attempt) throw new NotFoundException('IDENTITY_VERIFICATION_ATTEMPT_NOT_FOUND');

      await this.verificationRepository.resolveAttempt(
        attempt,
        {
          finalResult: approved ? 'verified' : 'rejected',
          reviewedBy: input.currentUser.internalUserId ?? null,
          notes: input.body.notes ?? null,
          now,
        },
        { transaction },
      );
      await this.verificationRepository.resolveIdentityDocument(
        input.tenantId,
        input.customerId,
        { verificationStatus: approved ? 'verified' : 'rejected', now },
        { transaction },
      );

      const pendingReviews = await this.verificationRepository.findPendingReviews(input.tenantId, input.customerId, { transaction });
      for (const review of pendingReviews) {
        await this.verificationRepository.resolveReview(
          review,
          {
            reviewStatus: approved ? 'approved' : 'rejected',
            reviewedBy: input.currentUser.internalUserId ?? null,
            rejectionReasonCode: approved ? null : input.body.reasonCode,
            notes: input.body.notes ?? null,
            now,
          },
          { transaction },
        );
      }

      // Un rechazo devuelve al cliente a corregir; una aprobación no lo habilita por sí sola: la
      // habilitación sigue dependiendo de las quince condiciones de la regla, que se reevalúa aquí.
      if (!approved) {
        await this.lifecycleService.advance({
          tenantId: input.tenantId,
          customerId: input.customerId,
          toStatus: 'observed',
          reasonCode: input.body.reasonCode,
          changedByType: input.currentUser.role,
          changedByInternalUserId: input.currentUser.internalUserId ?? null,
          notes: input.body.notes ?? null,
          transaction,
        });
      }

      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.identity_verification.decision',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: {
            decision: input.body.decision,
            reasonCode: input.body.reasonCode,
            attemptId: String(attempt.id),
            resolvedEvidenceReviews: pendingReviews.length,
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
        decisionSource: 'manual_decision',
        reasonCode: input.body.reasonCode,
        transaction,
      });

      return {
        customerId: input.customerId,
        decision: input.body.decision,
        identityVerificationResult: approved ? 'verified' : 'rejected',
        resolvedEvidenceReviews: pendingReviews.length,
        lifecycleStatus: evaluation.lifecycleStatus,
        eligible: evaluation.eligible,
        blockers: evaluation.blockers,
      };
    });
  }
}
