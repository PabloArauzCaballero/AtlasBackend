/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza traslada la decisión de crédito a una política versionada, aprobada y auditable.
 * @system compone las variables, ejecuta la política del motor y traduce su respuesta al dominio de crédito.
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { DecisionEngineClient } from './decision-engine.client.js';
import { DecisionOutcome, DecisionResponse } from './decision-engine.types.js';
import { FeatureProjectionService } from './feature-projection.service.js';
import { SubjectReferenceService } from './subject-reference.service.js';

/** Desenlaces del motor que el core interpreta como «no se concede». */
const DECLINE_OUTCOMES = new Set(['DECLINE', 'DECLINED', 'REJECT', 'REJECTED', 'DENY', 'DENIED']);

/** Desenlaces que conceden sin intervención. */
const APPROVE_OUTCOMES = new Set(['APPROVE', 'APPROVED', 'ACCEPT', 'ACCEPTED', 'GRANT', 'GRANTED']);

/** Estados de ejecución que significan que el grafo llegó al final. */
const COMPLETED_STATUSES = new Set(['COMPLETED', 'SUCCESS', 'SUCCEEDED']);

export type CreditDecisionRequest = {
  tenantId: string;
  customerId: string;
  applicationId: string;
  applicationCode: string;
  requestedAmount: string;
  requestedTermMonths: number;
  currencyCode: string;
  productCode: string | null;
  purposeCode: string | null;
  correlationId?: string;
};

export type CreditDecisionResult = {
  outcome: DecisionOutcome;
  subjectReference: string | null;
  excludedFeatures: Array<{ featureCode: string; reason: string }>;
};

@Injectable()
export class CreditDecisionEngineService {
  private readonly logger = new Logger(CreditDecisionEngineService.name);

  constructor(
    private readonly client: DecisionEngineClient,
    private readonly features: FeatureProjectionService,
    private readonly subjects: SubjectReferenceService,
  ) {}

  get isEnabled(): boolean {
    return this.client.isConfigured;
  }

  /**
   * Pide al motor la decisión sobre una solicitud de crédito.
   *
   * Nunca lanza por fallo del motor: devuelve `engineUnavailable`. Quien llama tiene que poder
   * distinguir «la política dice que no» de «no llegué a preguntar», porque la respuesta correcta
   * a cada una es distinta —rechazar con motivos frente a mandar a revisión humana— y porque
   * confundirlas ensucia el monitoreo: una caída del motor se registraría como una cartera de
   * rechazos que la política nunca emitió.
   */
  async decide(request: CreditDecisionRequest): Promise<CreditDecisionResult> {
    if (!this.client.isConfigured) {
      return {
        outcome: { kind: 'engineUnavailable', reason: 'DECISION_ENGINE_NOT_CONFIGURED' },
        subjectReference: null,
        excludedFeatures: [],
      };
    }

    const now = new Date();
    const subjectReference = await this.subjects.register({ tenantId: request.tenantId, customerId: request.customerId });
    const projected = await this.features.projectForCustomer(request.tenantId, request.customerId, now);

    try {
      const response = await this.client.execute(env.DECISION_ENGINE_CREDIT_ARTIFACT, {
        // El identificador de la solicitud ES la clave de idempotencia: reintentar la misma decisión
        // debe devolver la misma ejecución y no crear una nueva en el historial del motor.
        requestId: `credit-app-${request.applicationCode}`,
        idempotencyKey: `credit-app-${request.applicationId}`,
        correlationId: request.correlationId ?? randomUUID(),
        subjectReference,
        variables: {
          ...projected.variables,
          requested_amount: Number(request.requestedAmount),
          requested_term_months: request.requestedTermMonths,
          currency_code: request.currencyCode,
          product_code: request.productCode,
          purpose_code: request.purposeCode,
        },
        context: {
          source: 'atlas-backend',
          applicationId: request.applicationId,
          featureLineage: projected.lineage,
        },
      });

      return {
        outcome: this.interpret(response),
        subjectReference,
        excludedFeatures: projected.excluded,
      };
    } catch (error) {
      const reason = (error as Error).message ?? 'DECISION_ENGINE_CALL_FAILED';
      this.logger.error(`El motor no pudo decidir la solicitud ${request.applicationCode}: ${reason}`);
      return { outcome: { kind: 'engineUnavailable', reason }, subjectReference, excludedFeatures: projected.excluded };
    }
  }

  /**
   * Traduce la respuesta del motor al vocabulario del dominio de crédito.
   *
   * Sólo se aprueba con una lista CERRADA de desenlaces. Todo lo demás va a revisión humana, y eso
   * incluye los desenlaces que el core aún no sabe leer: un artefacto puede publicar mañana un
   * `APPROVE_WITH_CONDITIONS` o un `COUNTER_OFFER`, y tratarlos como aprobación por no reconocerlos
   * concedería un crédito en condiciones que nadie ha implementado. La lista blanca convierte ese
   * caso en una cola de revisión, que es visible, en vez de en dinero entregado, que no lo es.
   *
   * Una ejecución que no llegó al final tampoco aprueba ni rechaza: no hay decisión que aplicar.
   */
  private interpret(response: DecisionResponse): DecisionOutcome {
    const outcome = (response.outcome ?? '').toUpperCase();
    if (!COMPLETED_STATUSES.has(response.status.toUpperCase())) return { kind: 'review', response };
    if (DECLINE_OUTCOMES.has(outcome)) return { kind: 'declined', response };
    if (APPROVE_OUTCOMES.has(outcome)) return { kind: 'approved', response };
    return { kind: 'review', response };
  }

  /** Los motivos que la normativa obliga a comunicar cuando se rechaza. */
  static adverseActionReasons(response: DecisionResponse): string[] {
    return response.reasonCodes.filter((reason) => reason.adverseAction === true).map((reason) => reason.code);
  }
}
