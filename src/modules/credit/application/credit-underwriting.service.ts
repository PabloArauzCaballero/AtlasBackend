/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza traslada la decisión de crédito a una política versionada, aprobada y auditable.
 * @system aplica al expediente la decisión del motor, o lo deriva a revisión si el motor no respondió.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { CreditDecisionEngineService } from '../../decision-engine/credit-decision-engine.service.js';
import { DecisionOutcome, DecisionResponse } from '../../decision-engine/decision-engine.types.js';
import { CreditRepository } from '../credit.repository.js';

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
   * decidirse aquí queda en la cola y se resuelve en el siguiente intento o a mano.
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

      const previousStatus = application.status;
      // Mientras se preguntaba al motor pudo decidirla una persona: una respuesta tardía no pisa eso.
      if (previousStatus !== 'submitted') {
        return { status: previousStatus, decisionMode: application.decisionMode ?? null, executionId: null, reasonCodes: [] };
      }
      const applied = this.resolve(result.outcome);

      Object.assign(application, decisionColumns(applied, result.subjectReference, now), {
        decisionReasonCode: applied.reasonCodes[0] ?? application.decisionReasonCode,
      });
      await application.save({ transaction });

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
          payloadJson: decisionEventPayload(applied, result.excludedFeatures),
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
        reasonCodes: [],
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

/**
 * Lo que el historial guarda de la decisión, además del estado.
 *
 * `manualReviewCaseCode` es el caso que el Motor abrió, si abrió alguno: es lo que dice dónde se
 * resuelve. Con caso, la bandeja buena es la del Motor y la decisión humana de aquí se rechaza
 * (`CREDIT_DECISION_DELEGADA_AL_MOTOR`); sin caso —un rechazo— no hay nada que delegar. Las
 * features que el catálogo prohíbe usar al decidir se informan: quien audite tiene que poder
 * distinguir «no había dato» de «había y no se podía usar».
 */
function decisionEventPayload(
  applied: { decisionMode: string; response: DecisionResponse | null },
  excludedFeatures: Array<{ featureCode: string; reason: string }>,
): Record<string, unknown> {
  return {
    decisionMode: applied.decisionMode,
    executionId: applied.response?.executionId ?? null,
    artifactVersionId: applied.response?.artifact?.versionId ?? null,
    outcome: applied.response?.outcome ?? null,
    manualReviewCaseCode: applied.response?.manualReview?.caseCode ?? null,
    manualReviewQueueCode: applied.response?.manualReview?.queueCode ?? null,
    excludedFeatures,
  };
}

/**
 * Las columnas que el expediente guarda de la decisión del motor.
 *
 * Se construyen en bloque porque describen UNA decisión: escribir el estado nuevo junto al
 * `execution_id` de la anterior no falla al guardar, deja un expediente que atribuye su estado a una
 * ejecución que no lo produjo — y esa atribución es justo lo que el monitoreo del motor mide.
 *
 * `decidedAt` queda en `null` mientras el estado siga siendo `submitted`: una solicitud que aún no
 * se decidió no puede llevar fecha de decisión, y ponerla «por completitud» inventa un hecho.
 */
function decisionColumns(
  applied: { status: string; decisionMode: string; response: DecisionResponse | null },
  subjectReference: string | null,
  now: Date,
) {
  const response = applied.response;
  return {
    status: applied.status,
    decisionMode: applied.decisionMode,
    decisionExecutionId: response?.executionId ?? null,
    decisionArtifactVersionId: response?.artifact?.versionId ?? null,
    decisionSubjectReference: subjectReference,
    decisionScore: response?.score === null || response?.score === undefined ? null : String(response.score),
    decisionRiskBand: response?.riskBand ?? null,
    decisionReasonsJson: response?.reasonCodes ?? null,
    decidedAt: applied.status === 'submitted' ? null : now,
    decisionValidUntil: engineValidUntil(applied),
    businessAcceptance: pendingBusinessAcceptance(applied),
    updatedAtValue: now,
  };
}

/**
 * Si esta decisión queda pendiente de que el negocio la acepte.
 *
 * El motor responde «¿este solicitante cumple los criterios de riesgo?»; el negocio responde
 * «¿queremos esta operación ahora?», que depende de cosas que el motor no mira —cupo del mes,
 * concentración en un comercio, liquidez, una campaña cerrada—. Hasta aquí la segunda pregunta no
 * se hacía: el motor aprobaba, la solicitud quedaba `approved` —estado CERRADO— y el endpoint de
 * decisión manual respondía `CREDIT_APPLICATION_ALREADY_DECIDED`. El motor no proponía: disponía.
 *
 * Sólo se marca en las del MOTOR. Una aprobación firmada por una persona ya lleva dentro la
 * voluntad del negocio, y pedir una segunda aceptación sería pedir dos veces lo mismo — el segundo
 * clic se acaba dando sin mirar.
 *
 * Vive en su propia función y no dentro de `decisionColumns` porque allí subía la complejidad del
 * mapeo por encima del tope del proyecto, y porque es una regla de negocio con nombre propio: no
 * es una columna más que se calcula, es la pregunta que faltaba.
 */
function pendingBusinessAcceptance(applied: { status: string; decisionMode: string }): string | null {
  if (applied.status !== 'approved') return null;
  return applied.decisionMode === 'decision_engine' ? 'pending' : null;
}

/** La vigencia que el motor puso a SU aprobación; la concesión usa lo primero que venza (P-11). */
function engineValidUntil(applied: { status: string; response: DecisionResponse | null }): Date | null {
  const raw = applied.status === 'approved' ? applied.response?.decisionValidUntil : null;
  return raw ? new Date(raw) : null;
}
