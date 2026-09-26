/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza traslada la decisión de crédito a una política versionada, aprobada y auditable.
 * @system compone las variables, ejecuta la política del motor y traduce su respuesta al dominio de crédito.
 */
import { DecisionArtifactBindingService } from './decision-artifact-binding.service.js';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TracingService } from '../../common/observability/tracing.service.js';
import { APP_ATTRIBUTES, DECISION_ATTRIBUTES, SPAN_NAMES } from '../../observability/telemetry.constants.js';
import { env } from '../../config/env.js';
import { DecisionEngineClient } from './decision-engine.client.js';
import { DecisionOutcome, DecisionResponse } from './decision-engine.types.js';
import { classifyDecision } from './decision-verdict.js';
import { FeatureProjectionService } from './feature-projection.service.js';
import { SubjectReferenceService } from './subject-reference.service.js';
import { UnderwritingFeaturesService } from './underwriting-features.service.js';
import { basisBlocker, ensureUnderwritingBasis } from './underwriting-basis.js';
import type { VariableMetadata } from './decision-engine.types.js';

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
    private readonly tracing: TracingService,
    private readonly client: DecisionEngineClient,
    private readonly features: FeatureProjectionService,
    private readonly underwriting: UnderwritingFeaturesService,
    private readonly subjects: SubjectReferenceService,
    private readonly artifactBindings: DecisionArtifactBindingService,
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
    // `credit.evaluate` es la operación por la que pregunta soporte cuando un solicitante llama:
    // agrupa la proyección de variables, la resolución del artefacto y la llamada al motor en un
    // solo tramo legible. Sin datos del solicitante: ni importe, ni plazo, ni identidad. Lo que sí
    // lleva es el DESENLACE, que es de cardinalidad cerrada y es la pregunta que se hace siempre.
    return this.tracing.runInSpan(
      SPAN_NAMES.creditEvaluate,
      {
        [APP_ATTRIBUTES.module]: 'credit',
        [APP_ATTRIBUTES.operation]: 'evaluate',
        [APP_ATTRIBUTES.entityType]: 'credit-application',
        [APP_ATTRIBUTES.entityId]: request.applicationId,
        [APP_ATTRIBUTES.tenantId]: String(request.tenantId),
      },
      async (span) => {
        const result = await this.evaluate(request);
        span.setAttribute(DECISION_ATTRIBUTES.outcome, result.outcome.kind);
        // Un motor inalcanzable NO marca el span como error: es una degradación prevista que el
        // dominio traduce a revisión humana. Marcarlo confundiría «la política dijo que no» con
        // «no llegué a preguntar», que es justo la distinción que este servicio existe para
        // preservar. Queda como evento, visible sin contaminar la tasa de error.
        if (result.outcome.kind === 'engineUnavailable') {
          span.addEvent('engine.unavailable', { [DECISION_ATTRIBUTES.reason]: result.outcome.reason });
        }
        return result;
      },
    );
  }

  private async evaluate(request: CreditDecisionRequest): Promise<CreditDecisionResult> {
    if (!this.client.isConfigured) {
      return {
        outcome: { kind: 'engineUnavailable', reason: 'DECISION_ENGINE_NOT_CONFIGURED' },
        subjectReference: null,
        excludedFeatures: [],
      };
    }

    const now = new Date();
    const subjectReference = await this.subjects.register({ tenantId: request.tenantId, customerId: request.customerId });

    /*
     * La base habilitante ANTES de preguntar (P-09). El motor, sin base, responde 422
     * `ENABLING_BASIS_MISSING` y guarda esa respuesta en la clave de idempotencia; antes la base se
     * registraba después de la primera decisión y todo solicitante nuevo salía a revisión. Si la base
     * no llega, NO se pregunta: la solicitud queda diferida para reintentar, nunca rechazada.
     */
    const basis = await ensureUnderwritingBasis(this.client.consents, {
      tenantId: request.tenantId,
      customerId: request.customerId,
      subjectReference,
      now,
    });
    const blocked = basisBlocker(basis);
    if (blocked) {
      this.logger.warn(`La solicitud ${request.applicationCode} no se decide todavía: ${blocked.reason} (${basis.error ?? basis.status}).`);
      return { outcome: blocked, subjectReference, excludedFeatures: [] };
    }

    const projected = await this.features.projectForCustomer(request.tenantId, request.customerId, now);

    /*
     * El expediente del cliente, además del feature store.
     *
     * Hasta ahora esta llamada mandaba cinco variables —importe, plazo, moneda, producto y
     * propósito— y ni una sola del cliente, porque el feature store todavía no tiene valores
     * cargados para nadie. El artefacto declara cincuenta y siete entradas, así que la política
     * decidía sobre el vacío: el mismo veredicto para todo el mundo.
     *
     * Se compone del expediente REAL —ingreso, gastos, empleo, identidad, historial de pago— y el
     * feature store se superpone encima cuando tenga valores, porque ese sí pasa por el gobierno del
     * catálogo y debe poder corregir lo que aquí se deriva.
     */
    const underwriting = await this.underwriting.build({
      tenantId: request.tenantId,
      customerId: request.customerId,
      requestedAmount: Number(request.requestedAmount),
      requestedTermMonths: request.requestedTermMonths,
      now,
    });

    try {
      // Ver `decision-artifact-binding.service.ts`: quien decide un credito se elige en el portal.
      const binding = await this.artifactBindings.resolve(String(request.tenantId), 'credit');
      const response = await this.client.execute(binding.artifactCode ?? env.DECISION_ENGINE_CREDIT_ARTIFACT, {
        // La solicitud Y la base con la que se pide: reintentar con la misma base devuelve la misma
        // ejecución, y una base nueva pide una decisión nueva (la respuesta sin base queda guardada
        // en el motor bajo la clave anterior y no se puede reutilizar).
        requestId: `credit-app-${request.applicationCode}`,
        idempotencyKey: `credit-app-${request.applicationId}:basis-${basis.marker ?? '0'}`,
        correlationId: request.correlationId ?? randomUUID(),
        subjectReference,
        variables: {
          ...underwriting.variables,
          ...projected.variables,
          requested_amount: Number(request.requestedAmount),
          requested_term_months: request.requestedTermMonths,
          currency_code: request.currencyCode,
          product_code: request.productCode,
          purpose_code: request.purposeCode,
        },
        // De cuándo es cada dato (P-10); lo del feature store, desde que vale en el catálogo.
        variableMetadata: {
          ...underwriting.variableMetadata,
          ...featureMetadata(projected.lineage),
        },
        context: {
          source: 'atlas-backend',
          applicationId: request.applicationId,
          featureLineage: projected.lineage,
          // Qué variable era dato real, cuál derivada y cuál ausente: sin esto, una decisión rara
          // no se puede depurar sin reconstruir a mano el expediente de aquel día.
          provenance: underwriting.provenance,
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
   * Traduce la respuesta del motor al vocabulario del dominio de crédito con `classifyDecision`
   * (P-10): lista blanca de estados y desenlaces, y una aprobación sólo si llega limpia —sin caso de
   * revisión abierto, sin motivo técnico, sin bandera de revisión—. Todo lo demás, incluido lo que el
   * core aún no sabe leer, va a revisión humana: falla cerrado.
   */
  private interpret(response: DecisionResponse): DecisionOutcome {
    const verdict = classifyDecision(response);
    if (verdict.kind !== 'review') return { kind: verdict.kind, response };
    this.logger.warn(`Decisión ${response.executionId} derivada a revisión: ${verdict.reason}`);
    return { kind: 'review', response, technical: verdict.technical === true, reason: verdict.reason };
  }

  /** Los motivos que la normativa obliga a comunicar cuando se rechaza. */
  static adverseActionReasons(response: DecisionResponse): string[] {
    return response.reasonCodes.filter((reason) => reason.adverseAction === true).map((reason) => reason.code);
  }
}

/** Las variables del feature store, fechadas desde que su valor vale en el catálogo. */
export function featureMetadata(lineage: ReadonlyArray<{ featureCode: string; observedAt?: Date | null }>): VariableMetadata {
  const result: VariableMetadata = {};
  for (const entry of lineage) {
    if (entry.observedAt && !Number.isNaN(new Date(entry.observedAt).getTime())) {
      result[entry.featureCode] = { observedAt: new Date(entry.observedAt).toISOString() };
    }
  }
  return result;
}
