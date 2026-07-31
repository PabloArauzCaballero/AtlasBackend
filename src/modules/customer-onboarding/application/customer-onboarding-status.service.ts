/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { normalizeLifecycleStatus } from '../../customers/customer-lifecycle.constants.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerEligibilityRepository } from '../../customers/repositories/customer-eligibility.repository.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { CustomerOnboardingFlowRepository } from '../repositories/customer-onboarding-flow.repository.js';

/**
 * Estado y avance del onboarding (N1), envío del paquete a revisión (N8) y observaciones (N9).
 *
 * Este servicio existe para resolver un problema concreto: no había forma de reanudar el proceso.
 * Un cliente que cerraba la app no tenía a dónde volver, porque `GET /customers/:id/me` devolvía
 * `onboarding: null` fijo y un `nextStep` calculado sobre estados que ningún código escribía.
 *
 * El porcentaje de avance y el `nextStep` se derivan del MISMO evaluador que decide la habilitación
 * (`CustomerEligibilityService`), de modo que la pantalla de progreso y la puerta de entrada al
 * crédito no puedan discrepar jamás.
 */
@Injectable()
export class CustomerOnboardingStatusService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly flowRepository: CustomerOnboardingFlowRepository,
    private readonly eligibilityService: CustomerEligibilityService,
    private readonly eligibilityRepository: CustomerEligibilityRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async getStatus(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const [assessment, flow] = await Promise.all([
      this.eligibilityService.evaluate(input.tenantId, input.customerId),
      this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId),
    ]);

    return {
      customerId: input.customerId,
      lifecycleStatus: assessment.lifecycleStatus,
      creditEligibilityStatus: customer.creditEligibilityStatus,
      onboarding: flow
        ? {
            onboardingFlowId: String(flow.id),
            flowVersion: flow.flowVersion,
            completionStatus: flow.completionStatus,
            startedAt: flow.startedAt?.toISOString() ?? null,
            completedAt: flow.completedAt?.toISOString() ?? null,
            abandonedAt: flow.abandonedAt?.toISOString() ?? null,
          }
        : null,
      completionPercentage: assessment.completionPercentage,
      sections: assessment.sections,
      canSubmit: assessment.canSubmit && assessment.lifecycleStatus !== 'under_review',
      nextStep: assessment.nextStep,
      blockers: assessment.blockers,
    };
  }

  /**
   * Envía el paquete a revisión.
   *
   * Aquí —y no en cada guardado parcial— se verifica la completitud. Es la separación que hace
   * posible el autoguardado: guardar valida formato, enviar valida obligatoriedad.
   */
  async submitForReview(input: {
    tenantId: string;
    customerId: string;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const status = normalizeLifecycleStatus(customer.lifecycleStatus);
    if (status === 'under_review') throw new UnprocessableEntityException('ONBOARDING_ALREADY_SUBMITTED');

    const assessment = await this.eligibilityService.evaluate(input.tenantId, input.customerId);
    if (!assessment.canSubmit) {
      const pending = assessment.sections.filter((section) => section.status !== 'completed').map((section) => section.code);
      throw new UnprocessableEntityException(`ONBOARDING_INCOMPLETE: ${pending.join(', ')}`);
    }

    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      await this.lifecycleService.transition({
        tenantId: input.tenantId,
        customerId: input.customerId,
        toStatus: 'under_review',
        reasonCode: 'onboarding_submitted',
        changedByType: input.currentUser.role,
        changedByInternalUserId: input.currentUser.internalUserId ?? null,
        notes: 'Paquete de onboarding enviado a revisión por el cliente.',
        transaction,
      });

      const flow = await this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });
      if (flow) {
        // Cierre real del flujo: sin esto no existen tasa de conversión ni tiempo por etapa.
        await this.flowRepository.closeOnboardingFlow(flow, { completionStatus: 'completed', closedAt: now }, { transaction });
        await this.onboardingRepository.createOnboardingStepEvent(
          {
            tenantId: input.tenantId,
            onboardingFlowId: String(flow.id),
            stepCode: 'onboarding_submitted',
            eventType: 'completed',
            happenedAt: now,
            payloadJson: { completionPercentage: assessment.completionPercentage },
          },
          { transaction },
        );
      }

      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.submitted',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: { onboardingFlowId: flow ? String(flow.id) : null, sections: assessment.sections.map((s) => s.code) },
          occurredAt: now,
        },
        { transaction },
      );

      // Reevalúa dentro de la misma transacción: si nada más falta, promueve a `active`.
      const evaluated = await this.eligibilityService.evaluateAndRecord({
        tenantId: input.tenantId,
        customerId: input.customerId,
        evaluatedByType: input.currentUser.role,
        evaluatedByInternalUserId: input.currentUser.internalUserId ?? null,
        decisionSource: 'automatic',
        reasonCode: 'onboarding_submitted',
        transaction,
      });

      return {
        customerId: input.customerId,
        lifecycleStatus: evaluated.lifecycleStatus,
        eligible: evaluated.eligible,
        blockers: evaluated.blockers,
        nextStep: evaluated.nextStep,
      };
    });
  }

  /**
   * Observaciones abiertas, en el lenguaje del cliente.
   *
   * Antes, un analista podía cerrar un caso con `request_more_information` y el cliente no tenía
   * ninguna forma de enterarse de qué le pedían: no existía endpoint ni notificación.
   */
  async listObservations(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const [issues, cases, assessment] = await Promise.all([
      this.eligibilityRepository.findOpenIssues(input.tenantId, input.customerId),
      this.eligibilityRepository.findOpenReviewCases(input.tenantId, input.customerId),
      this.eligibilityService.evaluate(input.tenantId, input.customerId),
    ]);

    return {
      customerId: input.customerId,
      lifecycleStatus: assessment.lifecycleStatus,
      observations: issues.map((issue) => ({
        observationId: String(issue.id),
        source: 'data_quality' as const,
        status: issue.issueStatus,
        detectedAt: issue.detectedAt?.toISOString() ?? null,
      })),
      reviewCases: cases.map((reviewCase) => ({
        caseId: String(reviewCase.id),
        caseType: reviewCase.caseType,
        priority: reviewCase.priority,
        status: reviewCase.status,
        openedAt: reviewCase.openedAt?.toISOString() ?? null,
        // `notes` del analista NO se expone al cliente: puede contener criterio interno de riesgo.
      })),
      blockers: assessment.blockers,
      nextStep: assessment.nextStep,
    };
  }
}
