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
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { normalizeLifecycleStatus } from '../../customers/customer-lifecycle.constants.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerEligibilityRepository } from '../../customers/repositories/customer-eligibility.repository.js';
import { CustomerEligibilityRiskRepository } from '../../customers/repositories/customer-eligibility-risk.repository.js';
import { RiskService } from '../../risk/risk.service.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { CustomerOnboardingFlowRepository } from '../repositories/customer-onboarding-flow.repository.js';

/** Estados desde los que el envío a revisión tiene sentido. El resto es un error de negocio. */
const SUBMITTABLE_STATUSES = ['registered', 'onboarding_in_progress', 'observed'] as const;

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
  private readonly logger = new Logger(CustomerOnboardingStatusService.name);

  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly flowRepository: CustomerOnboardingFlowRepository,
    private readonly eligibilityService: CustomerEligibilityService,
    private readonly eligibilityRepository: CustomerEligibilityRepository,
    // Observaciones y casos abiertos: lo que el banco encontró sobre el cliente.
    private readonly eligibilityRiskRepository: CustomerEligibilityRiskRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    private readonly riskService: RiskService,
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
    // Desde `active`, `suspended`, `rejected`, `blocked` o `closed` el envío no procede. Antes se
    // dejaba caer hasta `transition()`, que respondía `INVALID_STATUS_TRANSITION` —un error de
    // máquina de estados— en vez de decir que el paquete ya no está en juego.
    if (!(SUBMITTABLE_STATUSES as readonly string[]).includes(status)) {
      throw new UnprocessableEntityException(`ONBOARDING_NOT_SUBMITTABLE_IN_STATUS: ${status}`);
    }

    const assessment = await this.eligibilityService.evaluate(input.tenantId, input.customerId);
    if (!assessment.canSubmit) {
      const pending = assessment.sections.filter((section) => section.status !== 'completed').map((section) => section.code);
      throw new UnprocessableEntityException(`ONBOARDING_INCOMPLETE: ${pending.join(', ')}`);
    }

    // Evaluación de riesgo del onboarding, ANTES de abrir la transacción del envío.
    //
    // Es lo que faltaba para que la habilitación automática pudiera ocurrir alguna vez: la regla
    // exige `RISK_NOT_APPROVED` resuelto (`customer-eligibility.evaluator.ts`) y nada en todo el
    // onboarding disparaba una evaluación — `createRiskAssessment` solo existía como endpoint HTTP,
    // así que el cliente quedaba en `under_review` indefinidamente esperando a que un analista
    // hiciera a mano un paso que el flujo nunca pidió.
    //
    // Corre fuera de la transacción a propósito: consulta al motor de políticas versionadas, y una
    // llamada de red dentro de la transacción mantendría locks abiertos toda su latencia. Si falla,
    // el envío igual procede y queda como bloqueador explícito, no como error opaco.
    await this.runOnboardingRiskAssessment(input);

    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      // Relectura DENTRO de la transacción: dos envíos concurrentes pasaban los dos el control de
      // arriba —la completitud se evaluaba fuera— y el segundo terminaba respondiendo
      // `INVALID_STATUS_TRANSITION`. Aquí el perdedor de la carrera recibe el mismo error de negocio
      // que quien simplemente reintenta.
      const current = await this.customersRepository.findById(input.tenantId, input.customerId, { transaction });
      if (!current) throw new NotFoundException('Cliente no encontrado.');
      if (normalizeLifecycleStatus(current.lifecycleStatus) === 'under_review') {
        throw new UnprocessableEntityException('ONBOARDING_ALREADY_SUBMITTED');
      }

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
   * Dispara la evaluación de riesgo del onboarding.
   *
   * Se degrada con un bloqueador en vez de tumbar el envío: si el motor de políticas no responde, el
   * paquete igual queda enviado y la elegibilidad lo reporta como `RISK_NOT_APPROVED` —que es la
   * verdad— hasta que la evaluación se rehaga. Perder el envío completo por una caída del motor
   * obligaría al cliente a repetir todo el recorrido por un problema que no es suyo.
   */
  private async runOnboardingRiskAssessment(input: {
    tenantId: string;
    customerId: string;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }): Promise<void> {
    try {
      await this.riskService.createRiskAssessment({
        tenantId: input.tenantId,
        customerId: input.customerId,
        body: { assessmentType: 'onboarding_initial', channel: 'system' },
        currentUser: input.currentUser,
        // Clave derivada: el envío y su evaluación de riesgo son operaciones distintas y no pueden
        // compartir la misma entrada en `idempotency_keys`.
        idempotencyKey: `${input.idempotencyKey}:onboarding-risk`,
      });
    } catch (error) {
      this.logger.warn(
        `Envío a revisión del cliente ${input.customerId} registrado, pero la evaluación de riesgo falló: ${
          error instanceof Error ? error.message : 'error desconocido'
        }. La habilitación queda bloqueada por RISK_NOT_APPROVED hasta que se recalcule.`,
      );
    }
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
      this.eligibilityRiskRepository.findOpenIssues(input.tenantId, input.customerId),
      this.eligibilityRiskRepository.findOpenReviewCases(input.tenantId, input.customerId),
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
