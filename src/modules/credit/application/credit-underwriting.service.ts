/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza traslada la decisión de crédito a una política versionada, aprobada y auditable.
 * @system aplica al expediente la decisión del motor, o lo deriva a revisión si el motor no respondió.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { CreditDecisionEngineService } from '../../decision-engine/credit-decision-engine.service.js';
import { DecisionOutcome, DecisionResponse } from '../../decision-engine/decision-engine.types.js';
import { EventsService } from '../../events/events.service.js';
import { CreditRepository } from '../credit.repository.js';
import { CreditReviewCaseRepository } from '../credit-review-case.repository.js';
import { REVIEW_CASE_SOURCE } from '../credit-review-case.constants.js';
import { decisionColumns, decisionEventPayload, type PlacedReviewCase } from './credit-decision-mapping.js';
import { publishCreditDecisionRecorded } from './credit-decision-event-publisher.js';

/** Motivo con el que queda una solicitud que fue a revisión porque el motor no llegó a decidirla. */
export const ENGINE_UNAVAILABLE_REASON = 'engine_unavailable';

/** El motivo con el que se marca una solicitud diferida por falta de base en el motor. */
export const DEFERRED_BASIS_REASON = 'ENABLING_BASIS_NOT_REPLICATED';

export type UnderwritingResult = {
  status: string;
  decisionMode: string | null;
  executionId: string | null;
  reasonCodes: string[];
};

@Injectable()
export class CreditUnderwritingService {
  private readonly logger = new Logger(CreditUnderwritingService.name);

  constructor(
    private readonly engine: CreditDecisionEngineService,
    private readonly credit: CreditRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly reviewCases: CreditReviewCaseRepository,
    private readonly events: EventsService,
  ) {}

  /**
   * Resuelve una solicitud recién presentada consultando la política del motor.
   *
   * Se ejecuta FUERA de la transacción que creó la solicitud, y a propósito. La llamada al motor es
   * E/S de red: sostenerla dentro dejaría una transacción de base de datos abierta durante todo el
   * tiempo de respuesta de un sistema ajeno, y bastaría un motor lento para agotar el pool de
   * conexiones y tumbar operaciones que no tienen nada que ver con crédito.
   *
   * La consecuencia es que existe una ventana en la que la solicitud está creada y sin decidir. Es
   * el estado correcto —`submitted` significa exactamente eso— y es recuperable: quien no llegue a
   * decidirse aquí lo recoge `CreditSubmittedReconciliationService`, que vuelve a llamar a este
   * método (el motor deduplica por la clave de idempotencia de la solicitud). Por eso una solicitud
   * que YA no está `submitted` no se toca: dos caminos pueden llegar aquí y el segundo no puede
   * pisar la decisión del primero.
   */
  async underwrite(input: {
    tenantId: string;
    applicationId: string;
    customerId: string;
    applicationCode: string;
    requestedAmount: string;
    requestedTermMonths: number;
    currencyCode: string;
    productCode: string | null;
    purposeCode: string | null;
  }): Promise<UnderwritingResult> {
    const result = await this.engine.decide(input);
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      const application = await this.credit.findApplicationById(input.tenantId, input.applicationId, { transaction });
      if (!application) return { status: 'unknown', decisionMode: null, executionId: null, reasonCodes: [] };

      if (application.status !== 'submitted') {
        return {
          status: application.status,
          decisionMode: application.decisionMode,
          executionId: application.decisionExecutionId,
          reasonCodes: [],
        };
      }

      const previousStatus = application.status;
      // Mientras se preguntaba al motor pudo decidirla una persona: una respuesta tardía no pisa eso.
      if (previousStatus !== 'submitted') {
        return { status: previousStatus, decisionMode: application.decisionMode ?? null, executionId: null, reasonCodes: [] };
      }
      const applied = this.resolve(result.outcome);
      const reviewCase = await this.placeReviewCase(applied, input, now, transaction);

      Object.assign(application, decisionColumns(applied, result.subjectReference, now, reviewCase), {
        decisionReasonCode: applied.reasonCodes[0] ?? application.decisionReasonCode,
      });
      await application.save({ transaction });

      // T-11 (2026-09-26): el ERP necesita la banda de riesgo para que su regla de MDR por banda
      // (§1.2 del plan) case en el registro de la compra. Sólo se avisa una aprobación CON banda
      // real: una revisión o un rechazo no fijan tarifa, y sin banda el ERP no tiene con qué casar.
      if (applied.status === 'approved' && applied.response?.riskBand) {
        await publishCreditDecisionRecorded({
          sequelize: this.sequelize,
          events: this.events,
          input,
          applicationId: application.id,
          riskBand: applied.response.riskBand,
          now,
          transaction,
        });
      }

      await this.credit.createApplicationEvent(
        {
          tenantId: input.tenantId,
          creditApplicationId: input.applicationId,
          eventType: result.outcome.kind === 'deferred' ? 'decision_deferred' : 'decision_recorded',
          previousStatus,
          newStatus: application.status,
          actorType: 'decision_engine',
          actorInternalUserId: null,
          reasonCode: applied.reasonCodes[0] ?? null,
          payloadJson: decisionEventPayload(applied, result.excludedFeatures, reviewCase),
          notes: applied.note,
          happenedAt: now,
        },
        { transaction },
      );

      return {
        status: application.status,
        decisionMode: applied.decisionMode,
        executionId: applied.response?.executionId ?? null,
        reasonCodes: applied.reasonCodes,
      };
    });
  }

  /**
   * El reintento de las solicitudes diferidas porque la base habilitante no llegó al motor (P-09).
   *
   * Sólo las presentadas en las últimas `maxAgeHours`: pasado ese plazo, una solicitud de compra ya
   * no representa la voluntad del cliente en ese comercio, y se queda `submitted` a la vista de
   * operaciones en vez de decidirse sola días después. Una fila que vuelve a diferirse espera a la
   * pasada siguiente; una que falla no detiene a las demás.
   */
  async retryDeferred(input: { tenantId: string; limit: number; maxAgeHours: number; now?: Date }) {
    const now = input.now ?? new Date();
    const deferred = await this.credit.findDeferredApplications({
      tenantId: input.tenantId,
      reasonCode: DEFERRED_BASIS_REASON,
      since: new Date(now.getTime() - input.maxAgeHours * 3_600_000),
      limit: input.limit,
    });
    const summary = { candidates: deferred.length, decided: 0, stillDeferred: 0, failed: 0 };
    for (const application of deferred) {
      try {
        const product = await this.credit.findProductById(input.tenantId, String(application.creditProductId));
        const result = await this.underwrite({
          tenantId: input.tenantId,
          applicationId: String(application.id),
          customerId: String(application.customerId),
          applicationCode: application.applicationCode,
          requestedAmount: String(application.requestedAmount),
          requestedTermMonths: application.requestedTermMonths,
          currencyCode: application.currencyCode,
          productCode: product?.productCode ?? null,
          purposeCode: application.purposeCode ?? null,
        });
        if (result.status === 'submitted') summary.stillDeferred += 1;
        else summary.decided += 1;
      } catch (error) {
        summary.failed += 1;
        this.logger.error(`No se pudo reintentar la solicitud diferida ${application.applicationCode}: ${(error as Error).message}`);
      }
    }
    return summary;
  }

  /**
   * Deja la revisión en una bandeja que exista (C-1).
   *
   * Una solicitud que pasa a `under_review` tiene que tener quién la mire. Si el Motor abrió su
   * caso (`manualReview.caseCode`), esa es la bandeja y se registra su código. Si NO lo abrió —un
   * `review` sin caso, o un motor que no respondió— Atlas abre el suyo en `manual_review_cases`:
   * antes la solicitud quedaba sin bandeja en ningún sitio, y la decisión humana la rechazaba
   * además con «delegada al Motor» por el mero hecho de que el Motor la hubiera ejecutado. Es la
   * misma paridad que riesgo tiene con `motorAbrioCaso`. Lo que no espera a nadie (aprobada o
   * rechazada) no lleva caso.
   */
  private async placeReviewCase(
    applied: { status: string; note: string | null; response: DecisionResponse | null },
    input: { tenantId: string; customerId: string; applicationCode: string },
    now: Date,
    transaction: Transaction,
  ): Promise<PlacedReviewCase> {
    if (applied.status !== 'under_review') return { code: null, source: null };

    const engineCaseCode = applied.response?.manualReview?.caseCode;
    if (engineCaseCode) return { code: engineCaseCode, source: REVIEW_CASE_SOURCE.engine };

    const own = await this.reviewCases.open(
      {
        tenantId: input.tenantId,
        customerId: input.customerId,
        applicationCode: input.applicationCode,
        notes: applied.note ?? 'Solicitud de crédito pendiente de revisión humana.',
        now,
      },
      { transaction },
    );
    return { code: own.caseCode, source: REVIEW_CASE_SOURCE.atlas };
  }

  /**
   * Cómo se traduce cada desenlace del motor al estado del expediente.
   *
   * El caso que importa es `engineUnavailable`: la solicitud va a REVISIÓN, nunca a rechazo. Un
   * motor caído no es una política que rechaza, y convertirlo en rechazo negaría crédito a gente
   * que cumplía por una avería de infraestructura — además de contaminar la medida del modelo con
   * una cartera de rechazos que ninguna versión del artefacto emitió.
   */
  private resolve(outcome: DecisionOutcome): {
    status: string;
    decisionMode: string;
    response: DecisionResponse | null;
    reasonCodes: string[];
    note: string | null;
  } {
    if (outcome.kind === 'deferred') {
      // Ni rechazo ni aprobación: no se preguntó al motor porque la base habilitante no llegó (P-09).
      // Queda `submitted` —sin decidir— para que el reintento vuelva a pedir la decisión.
      this.logger.warn(`Decisión diferida; la solicitud queda para reintentar: ${outcome.reason}`);
      return {
        status: 'submitted',
        decisionMode: 'decision_engine',
        response: null,
        reasonCodes: [outcome.reason],
        note: `No se pidió la decisión al motor (${outcome.reason}). Se reintentará automáticamente.`,
      };
    }
    if (outcome.kind === 'engineUnavailable') {
      this.logger.warn(`Motor no disponible; la solicitud se deriva a revisión humana: ${outcome.reason}`);
      return {
        status: 'under_review',
        decisionMode: 'engine_unavailable_manual',
        response: null,
        // El motivo queda escrito en la fila y en el historial: una solicitud en revisión sin
        // motivo no dice si esperaba a una persona por política o por una avería (C-2).
        reasonCodes: [ENGINE_UNAVAILABLE_REASON],
        note: `El motor de decisión no respondió (${outcome.reason}). Requiere revisión humana.`,
      };
    }

    const reasonCodes = outcome.response.reasonCodes.map((reason) => reason.code);
    if (outcome.kind === 'approved') {
      return { status: 'approved', decisionMode: 'decision_engine', response: outcome.response, reasonCodes, note: null };
    }
    if (outcome.kind === 'declined') {
      return { status: 'rejected', decisionMode: 'decision_engine', response: outcome.response, reasonCodes, note: null };
    }
    /*
     * Revisión. Si el motor ABRIÓ un caso, la bandeja buena es la suya (`decision_engine`). Si no —un
     * `NO_DECISION` técnico (dato inválido, base ausente, salida económica fuera de rango), frescura
     * desconocida o un desenlace que el core no reconoce—, no hay caso que resolver allí: la revisión es
     * de Atlas (`engine_unavailable_manual`) o la solicitud quedaría sin bandeja para siempre. Nunca es
     * un rechazo crediticio del cliente ni una aprobación.
     */
    const delegated = Boolean(outcome.response.manualReview?.caseCode);
    return {
      status: 'under_review',
      decisionMode: delegated ? 'decision_engine' : 'engine_unavailable_manual',
      response: outcome.response,
      reasonCodes,
      note: outcome.technical
        ? `Revisión técnica: el motor no pudo decidir bien (${outcome.reason ?? outcome.response.status}). No es un rechazo.`
        : `El motor derivó la solicitud a revisión (${outcome.response.outcome ?? outcome.response.status}).`,
    };
  }
}
