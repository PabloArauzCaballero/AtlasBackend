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
      const applied = this.resolve(result.outcome);

      Object.assign(application, decisionColumns(applied, result.subjectReference, now), {
        decisionReasonCode: applied.reasonCodes[0] ?? application.decisionReasonCode,
      });
      await application.save({ transaction });

      await this.credit.createApplicationEvent(
        {
          tenantId: input.tenantId,
          creditApplicationId: input.applicationId,
          eventType: 'decision_recorded',
          previousStatus,
          newStatus: application.status,
          actorType: 'decision_engine',
          actorInternalUserId: null,
          reasonCode: applied.reasonCodes[0] ?? null,
          payloadJson: {
            decisionMode: applied.decisionMode,
            executionId: applied.response?.executionId ?? null,
            artifactVersionId: applied.response?.artifact?.versionId ?? null,
            outcome: applied.response?.outcome ?? null,
            // Las features que el catálogo prohíbe usar al decidir se informan: quien audite la
            // decisión tiene que poder distinguir «no había dato» de «había y no se podía usar».
            excludedFeatures: result.excludedFeatures,
          },
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
    return {
      status: 'under_review',
      decisionMode: 'decision_engine',
      response: outcome.response,
      reasonCodes,
      note: `El motor derivó la solicitud a revisión (${outcome.response.outcome ?? outcome.response.status}).`,
    };
  }
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
    updatedAtValue: now,
  };
}
