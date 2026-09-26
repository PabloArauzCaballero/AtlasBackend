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
import { CreditReviewCaseRepository } from '../credit-review-case.repository.js';
import { REVIEW_CASE_SOURCE } from '../credit-review-case.constants.js';

const DECISION_TO_STATUS: Readonly<Record<CreditApplicationDecisionDto['decision'], string>> = {
  approve: 'approved',
  reject: 'rejected',
  request_more_information: 'under_review',
};

const CLOSED_STATUSES = ['approved', 'rejected', 'cancelled', 'expired'];

/**
 * Modos de decisión que una decisión humana NO reescribe: dicen POR QUÉ una persona tuvo que decidir
 * y ese dato se perdería al aplanarlo a `manual` —un periodo con el Motor caído, resuelto a mano,
 * dejaría de distinguirse de uno con un producto que siempre pasa por revisión—.
 */
const PRESERVED_DECISION_MODES: ReadonlySet<string> = new Set(['engine_unavailable_manual', 'seed_demo']);

/**
 * ¿La bandeja de esta solicitud es la del Motor?
 *
 * Con el registro de C-1 la respuesta está en la fila: `manualReviewCaseSource`. Sólo si el Motor
 * abrió caso se delega; que el Motor haya EJECUTADO la solicitud no basta —un `review` sin
 * `caseCode` deja la solicitud sin bandeja allí, y rechazar la decisión humana la dejaba sin salida
 * en ningún sitio—. Las anteriores a C-1 no dicen quién abrió caso: se conserva lo que hacían.
 */
function reviewBelongsToEngine(application: {
  manualReviewCaseSource?: string | null;
  decisionExecutionId?: string | null;
  decisionMode?: string | null;
}): boolean {
  if (application.manualReviewCaseSource) return application.manualReviewCaseSource === REVIEW_CASE_SOURCE.engine;
  return Boolean(application.decisionExecutionId) && application.decisionMode === 'decision_engine';
}

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
    private readonly reviewCases: CreditReviewCaseRepository,
  ) {}

  async decide(input: { tenantId: string; applicationId: string; body: CreditApplicationDecisionDto; currentUser: AuthenticatedUser }) {
    return this.sequelize.transaction(async (transaction) => {
      const application = await this.creditRepository.findApplicationById(input.tenantId, input.applicationId, { transaction });
      if (!application) throw new NotFoundException('CREDIT_APPLICATION_NOT_FOUND');
      if (CLOSED_STATUSES.includes(application.status)) throw new ConflictException('CREDIT_APPLICATION_ALREADY_DECIDED');
      /*
       * Una solicitud cuyo caso vive EN el Motor no se decide aquí.
       *
       * Hasta el 2026-09-14 este método aprobaba cualquier solicitud abierta sin mirar
       * `decisionMode`: un operador podía convertir en `approved` —y desembolsable— una solicitud
       * que el Motor había derivado a su propia cola de revisión, y la respuesta a «quién aprobó»
       * era dos personas que no se ven. Con el caso del Motor la bandeja buena es la suya y su
       * resolución vuelve por `applyEngineManualReview`.
       *
       * El corte se hizo entonces por «el Motor ejecutó esto», y eso dejó un callejón (C-1): un
       * desenlace `review` SIN `manualReview.caseCode` no abre bandeja en el Motor, y esta guarda
       * rechazaba igual la decisión humana —la solicitud quedaba `under_review` sin salida en
       * ningún sitio—. Ahora se corta sólo cuando el Motor SÍ abrió caso (`reviewBelongsToEngine`);
       * si no lo abrió, Atlas abrió el suyo al recibir la respuesta y se decide aquí. Se corta en el
       * servicio y no en la pantalla porque una pantalla se salta con curl.
       */
      if (reviewBelongsToEngine(application)) {
        throw new ConflictException(
          `CREDIT_DECISION_DELEGADA_AL_MOTOR: la solicitud ${application.applicationCode ?? application.id} la decidió la ejecución ` +
            `${application.decisionExecutionId} del Motor; su revisión se resuelve allí.`,
        );
      }

      const previousStatus = application.status;
      const newStatus = DECISION_TO_STATUS[input.body.decision];
      const now = new Date();

      /*
       * Una decisión humana se escribe como humana (C-3). Antes sólo se tocaba `status` y el motivo,
       * así que un producto `requiresManualReview` —que nace sin modo— quedaba con `decision_mode`
       * NULO tras decidirlo una persona, y una solicitud que el Motor había mandado a revisión seguía
       * figurando `decision_engine` aunque la resolviera alguien a mano: cualquier tablero de «cuánto
       * aprueba el Motor» contaba una aprobación que el Motor no dio.
       */
      const decisionMode = PRESERVED_DECISION_MODES.has(application.decisionMode ?? '') ? application.decisionMode : 'manual';

      await this.creditRepository.updateApplicationStatus(
        application,
        {
          status: newStatus,
          reasonCode: input.body.reasonCode,
          decidedByInternalUserId: input.currentUser.internalUserId ?? null,
          now,
          decisionMode,
        },
        { transaction },
      );

      // El caso propio de Atlas se cierra con la solicitud, para que no quede en la cola de
      // operaciones un caso abierto de algo que ya está resuelto. `request_more_information` deja la
      // solicitud abierta y por eso deja también el caso.
      if (
        CLOSED_STATUSES.includes(newStatus) &&
        application.manualReviewCaseSource === REVIEW_CASE_SOURCE.atlas &&
        application.manualReviewCaseCode
      ) {
        await this.reviewCases.close(
          {
            tenantId: input.tenantId,
            caseCode: application.manualReviewCaseCode,
            resolution: input.body.decision,
            notes: input.body.notes ?? null,
            now,
          },
          { transaction },
        );
      }

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
