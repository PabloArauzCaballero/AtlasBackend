/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
 * @system coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { CreditApplicationDecisionDto } from '../credit.schemas.js';
import { CreditRepository } from '../credit.repository.js';

const DECISION_TO_STATUS: Readonly<Record<CreditApplicationDecisionDto['decision'], string>> = {
  approve: 'approved',
  reject: 'rejected',
  request_more_information: 'under_review',
};

const CLOSED_STATUSES = ['approved', 'rejected', 'cancelled', 'expired'];

/** Cómo quedó la solicitud tras la revisión humana que se hizo EN el Motor. */
const ENGINE_REVIEW_TO_STATUS: Readonly<Record<'APPROVE' | 'DECLINE', string>> = {
  APPROVE: 'approved',
  DECLINE: 'rejected',
};

/**
 * Decisión de operaciones sobre una solicitud de crédito.
 *
 * Mismo criterio que el resto de decisiones humanas del sistema: estado y evento de historial se
 * escriben en la MISMA transacción, toda decisión negativa exige una nota, y una solicitud ya
 * resuelta no se vuelve a decidir.
 */
@Injectable()
export class CreditDecisionService {
  constructor(
    private readonly creditRepository: CreditRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async decide(input: { tenantId: string; applicationId: string; body: CreditApplicationDecisionDto; currentUser: AuthenticatedUser }) {
    return this.sequelize.transaction(async (transaction) => {
      const application = await this.creditRepository.findApplicationById(input.tenantId, input.applicationId, { transaction });
      if (!application) throw new NotFoundException('CREDIT_APPLICATION_NOT_FOUND');
      if (CLOSED_STATUSES.includes(application.status)) throw new ConflictException('CREDIT_APPLICATION_ALREADY_DECIDED');
      /*
       * Una solicitud que el Motor YA vio no se decide aquí.
       *
       * Hasta el 2026-09-14 este método aprobaba cualquier solicitud abierta sin mirar
       * `decisionMode`: un operador podía convertir en `approved` —y desembolsable— una solicitud
       * que el Motor había derivado a su propia cola de revisión, y la respuesta a «quién aprobó»
       * era dos personas que no se ven. Con `decision_execution_id` la bandeja buena es la del
       * Motor y su resolución vuelve por `applyEngineManualReview`. La decisión humana de aquí
       * queda para lo que el Motor no llegó a ver: `engine_unavailable_manual` o una solicitud
       * anterior a la integración. Se corta en el servicio y no en la pantalla porque una pantalla
       * se salta con curl.
       */
      if (application.decisionExecutionId && application.decisionMode === 'decision_engine') {
        throw new ConflictException(
          `CREDIT_DECISION_DELEGADA_AL_MOTOR: la solicitud ${application.applicationCode ?? application.id} la decidió la ejecución ` +
            `${application.decisionExecutionId} del Motor; su revisión se resuelve allí.`,
        );
      }

      const previousStatus = application.status;
      const newStatus = DECISION_TO_STATUS[input.body.decision];
      const now = new Date();

      await this.creditRepository.updateApplicationStatus(
        application,
        {
          status: newStatus,
          reasonCode: input.body.reasonCode,
          decidedByInternalUserId: input.currentUser.internalUserId ?? null,
          now,
        },
        { transaction },
      );

      await this.creditRepository.createApplicationEvent(
        {
          tenantId: input.tenantId,
          creditApplicationId: input.applicationId,
          eventType: 'decision_recorded',
          previousStatus,
          newStatus,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          reasonCode: input.body.reasonCode,
          payloadJson: { decision: input.body.decision },
          notes: input.body.notes ?? null,
          happenedAt: now,
        },
        { transaction },
      );

      return {
        applicationId: input.applicationId,
        decision: input.body.decision,
        previousStatus,
        status: newStatus,
      };
    });
  }

  /**
   * La resolución de la revisión humana hecha EN el Motor, aplicada a la solicitud.
   *
   * Antes no existía: el analista aprobaba en el Motor, el caso quedaba `RESOLVED_APPROVED` allí, y
   * aquí la solicitud seguía `under_review` para siempre —resoluble sólo por el endpoint humano que
   * este mismo servicio ahora rechaza—. El puente es `executionId`, que la solicitud guarda desde
   * que pidió la decisión.
   *
   * Una aprobación así sigue siendo del MOTOR: queda `businessAcceptance = 'pending'`, igual que una
   * aprobación automática suya, porque la segunda pregunta —«¿queremos esta operación?»— no la
   * contestó nadie todavía.
   */
  async applyEngineManualReview(input: {
    tenantId: string;
    executionId: string;
    decision: 'APPROVE' | 'DECLINE';
    reason: string | null;
    resolvedByInternalUserId: string | null;
  }) {
    return this.sequelize.transaction(async (transaction) => {
      const application = await this.creditRepository.findApplicationByExecutionId(input.tenantId, input.executionId, { transaction });
      if (!application) throw new NotFoundException(`Ninguna solicitud de crédito nació de la ejecución ${input.executionId}.`);
      if (CLOSED_STATUSES.includes(application.status)) {
        return {
          applied: false,
          reason: 'CREDIT_APPLICATION_ALREADY_DECIDED',
          applicationId: String(application.id),
          status: application.status,
        };
      }

      const previousStatus = application.status;
      const newStatus = ENGINE_REVIEW_TO_STATUS[input.decision];
      const now = new Date();
      const reasonCode = input.decision === 'APPROVE' ? 'engine_manual_review_approved' : 'engine_manual_review_declined';

      await this.creditRepository.updateApplicationStatus(
        application,
        { status: newStatus, reasonCode, decidedByInternalUserId: input.resolvedByInternalUserId, now },
        { transaction },
      );
      if (newStatus === 'approved') {
        application.businessAcceptance = 'pending';
        await application.save({ transaction });
      }

      await this.creditRepository.createApplicationEvent(
        {
          tenantId: input.tenantId,
          creditApplicationId: String(application.id),
          eventType: 'decision_recorded',
          previousStatus,
          newStatus,
          actorType: 'decision_engine_manual_review',
          actorInternalUserId: input.resolvedByInternalUserId,
          reasonCode,
          payloadJson: { decision: input.decision, executionId: input.executionId },
          notes: input.reason,
          happenedAt: now,
        },
        { transaction },
      );

      return { applied: true, applicationId: String(application.id), previousStatus, status: newStatus };
    });
  }

  async getApplicationDetail(tenantId: string, applicationId: string) {
    const application = await this.creditRepository.findApplicationById(tenantId, applicationId);
    if (!application) throw new NotFoundException('CREDIT_APPLICATION_NOT_FOUND');
    const events = await this.creditRepository.findApplicationEvents(tenantId, applicationId);
    return { application, events };
  }
}
