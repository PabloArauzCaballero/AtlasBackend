/**
 * @file El recálculo de la línea de crédito y su escritura.
 * @business Cuánto puede gastar un cliente, con la razón escrita de por qué esa cifra y no otra.
 * @system compone capacidad de pago, riesgo y política vigente en una línea nueva, y la persiste.
 */
import { DecisionArtifactBindingService } from '../../decision-engine/decision-artifact-binding.service.js';
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { randomUUID } from 'node:crypto';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../../config/env.js';
import { CreditLineModel } from '../../../database/models/index.js';
import { DecisionEngineClient } from '../../decision-engine/decision-engine.client.js';
import { CREDIT_DECISION_PURPOSE, SubjectReferenceService } from '../../decision-engine/subject-reference.service.js';
import { UnderwritingFeaturesService } from '../../decision-engine/underwriting-features.service.js';
import { PaymentCapacityService } from './payment-capacity.service.js';
import { capacityProvenance, capacityVariables } from './credit-line.service.js';

/** Qué movió la línea. Se escribe siempre: una bajada sin causa visible parece un error. */
export type CalculationTrigger = 'onboarding' | 'bank_statement' | 'delinquency' | 'repayment' | 'manual' | 'application';

/**
 * El importe de referencia con el que se pide la línea cuando NO hay una compra concreta.
 *
 * El artefacto necesita un `requested_amount` para calcular la relación cuota/ingreso. Al abrir la
 * cuenta todavía no hay compra, así que se usa este importe como sonda: es el techo del producto, de
 * modo que la línea que sale es la máxima que la política concede a esa persona, no la que
 * cabría en una compra imaginaria más pequeña.
 */
const PROBE_AMOUNT = 5000;
const PROBE_TERM_MONTHS = 3;

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * La línea de crédito del cliente: de dónde sale y cuándo se recalcula.
 *
 * ## La política decide, el core la escribe
 *
 * El límite NO se calcula aquí. Se pide al artefacto de suscripción —el mismo que aprueba o rechaza
 * una compra— y se guarda tal y como lo devolvió, con la ejecución que lo produjo. Calcularlo en el
 * core pondría la regla de negocio más importante del producto fuera del sistema que existe para
 * gobernarla, versionarla y auditarla; y dos implementaciones de la misma regla acaban discrepando.
 *
 * ## Cuándo cambia
 *
 * Al abrir la cuenta, al subir un extracto bancario, al entrar o salir de mora, y a mano cuando
 * operaciones lo pide. Cada recálculo abre una versión nueva y cierra la anterior: el historial es
 * la respuesta a «¿por qué me bajó?», que es la pregunta que sigue a toda bajada.
 *
 * ## Si el motor no responde
 *
 * La línea vigente NO se toca. Un motor caído no es una política que rebaja: dejar el límite en cero
 * porque no hubo respuesta le corta el crédito a quien cumplía por una avería de infraestructura.
 */

/**
 * Sale de `CreditLineService` porque aquel archivo era una lectura corta —la línea vigente y su
 * historial— pegada a un cálculo de 230 líneas. Juntos pasaban del límite de `check:file-size`, y
 * quien sólo quiere saber cuál es la línea de un cliente no necesita leer cómo se calcula.
 */
import { CreditLineWriterService } from './credit-line-writer.service.js';
@Injectable()
export class CreditLineRecalculationService {
  private readonly logger = new Logger(CreditLineRecalculationService.name);

  constructor(
    @InjectModel(CreditLineModel) private readonly creditLines: typeof CreditLineModel,
    private readonly artifactBindings: DecisionArtifactBindingService,
    private readonly features: UnderwritingFeaturesService,
    private readonly client: DecisionEngineClient,
    private readonly subjects: SubjectReferenceService,
    private readonly capacity: PaymentCapacityService,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly escritor: CreditLineWriterService,
  ) {}

  /**
   * Vuelve a preguntarle al motor cuánto puede gastar este cliente, y lo escribe.
   *
   * Devuelve `null` cuando el motor no respondió: quien llama tiene que poder distinguir «la
   * política dice esto» de «no llegué a preguntar», porque la segunda no debe cambiar nada.
   */
  async recalculate(input: {
    tenantId: string;
    customerId: string;
    trigger: CalculationTrigger;
    /** Rechazos por fondos insuficientes leídos del extracto, cuando el recálculo viene de uno. */
    bankStatementNsfCount?: number | null;
    requestedAmount?: number;
    requestedTermMonths?: number;
    correlationId?: string;
  }): Promise<CreditLineModel | null> {
    if (!this.client.isConfigured) {
      this.logger.warn(`No se recalcula la línea del cliente ${input.customerId}: el motor no está configurado.`);
      return null;
    }

    const now = new Date();
    const requestedAmount = input.requestedAmount ?? PROBE_AMOUNT;
    const requestedTermMonths = input.requestedTermMonths ?? PROBE_TERM_MONTHS;

    const current = await this.escritor.lineaVigente(input.tenantId, input.customerId);
    const { variables, provenance } = await this.features.build({
      tenantId: input.tenantId,
      customerId: input.customerId,
      requestedAmount,
      requestedTermMonths,
      bankStatementNsfCount: input.bankStatementNsfCount ?? null,
      now,
    });

    /*
     * La PROPUESTA de límite, calculada antes de preguntar y enviada como una variable más.
     *
     * Es la respuesta a la pregunta que el motor no contestaba: no «¿sí o no?» sino «¿cuánto?». Sale
     * de cruzar lo que el extracto demuestra que puede pagar al mes con lo que la relación —
     * antigüedad, historial de pago dentro de Atlas y fidelización— permite conceder todavía.
     *
     * NO sustituye a la política: viaja al artefacto, el artefacto emite el límite, y se guardan las
     * dos cifras. Que las dos estén escritas es lo que permite responder «¿la política se apartó de
     * la capacidad medida, y cuánto?», que es la pregunta con la que se calibra un modelo de crédito.
     */
    const capacity = await this.capacity.assess({
      tenantId: input.tenantId,
      customerId: input.customerId,
      declaredMonthlyIncome: num(variables.declared_monthly_income) ?? null,
      currentLimit: current ? Number(current.approvedLimit) : null,
      termMonths: requestedTermMonths,
      now,
    });
    Object.assign(variables, capacityVariables(capacity));
    Object.assign(provenance, capacityProvenance(capacity));

    const subjectReference = await this.subjects.register({ tenantId: input.tenantId, customerId: input.customerId });

    let response;
    try {
      // El artefacto sale de la asignacion del portal; el entorno queda como respaldo.
      const binding = await this.artifactBindings.resolve(String(input.tenantId), 'credit');
      const creditArtifact = binding.artifactCode ?? env.DECISION_ENGINE_CREDIT_ARTIFACT;
      response = await this.client.execute(creditArtifact, {
        /*
         * La clave de idempotencia lleva el instante: a diferencia de una solicitud de compra —donde
         * reintentar DEBE devolver la misma decisión—, un recálculo de línea es un hecho nuevo cada
         * vez. Reusar la clave devolvería la ejecución vieja y la línea nunca se movería.
         */
        requestId: `credit-line-${input.customerId}-${now.getTime()}`,
        idempotencyKey: `credit-line-${input.customerId}-${input.trigger}-${now.getTime()}`,
        correlationId: input.correlationId ?? randomUUID(),
        subjectReference,
        variables,
        context: { source: 'atlas-backend', purpose: 'credit_line', trigger: input.trigger, provenance },
      });
    } catch (error) {
      this.logger.error(`El motor no pudo recalcular la línea del cliente ${input.customerId}: ${(error as Error).message}`);
      return null;
    }

    /*
     * El permiso del titular, replicado en el motor DESPUÉS de la decisión.
     *
     * ## Por qué hacía falta
     *
     * El motor comprueba, antes de cada decisión, que ningún permiso registrado del sujeto esté
     * vencido o revocado. Pero el backend —que es quien RECOGE el consentimiento en el alta— nunca
     * se lo contaba. Resultado: el motor no tenía permisos que comprobar, así que la comprobación
     * siempre pasaba. El control se ejercía sobre un conjunto vacío.
     *
     * ## Por qué DESPUÉS y no antes
     *
     * Porque el motor sólo conoce a un titular por sus decisiones: registrar el permiso antes de la
     * primera devuelve `SUBJECT_NOT_FOUND`. No es un orden caprichoso, es la consecuencia de que el
     * motor no guarde identidades — sólo referencias opacas que aparecen al decidir. La primera
     * decisión de cada cliente corre, por tanto, sin permiso registrado; y está bien, porque la
     * ausencia de permiso nunca bloquea: lo que bloquea es un permiso que EXISTE y ya no vale.
     *
     * ## La base legal, y por qué no es `CONSENT`
     *
     * Evaluar la capacidad de pago de quien pide un crédito no depende de que consienta cada
     * evaluación —depende de que haya pedido el crédito—. Tratarlo como consentimiento revocable
     * dejaría al motor sin poder decidir sobre un préstamo ya vivo, que es justo cuando más falta
     * hace. El consentimiento propiamente dicho cubre lo que SÍ es opcional (extracto bancario,
     * consultas al buró) y se registra con su propio propósito.
     *
     * No bloquea: si el motor no acepta la réplica, la línea se guarda igual. El permiso ya es
     * válido en el sistema donde vive el dato personal; lo que falta es que el motor se entere.
     */
    await this.client.recordConsent({
      subjectReference,
      purpose: CREDIT_DECISION_PURPOSE,
      basis: 'CREDIT_PROTECTION',
      grantedAt: now,
    });

    const output = (response.output ?? {}) as Record<string, unknown>;

    /*
     * El límite se lee del artefacto y no se corrige aquí. Si la política devuelve algo que el core
     * no sabe leer, se guarda CERO y el desenlace real: es visible y se puede investigar, mientras
     * que rellenarlo con un número «razonable» escribiría en el expediente del cliente una cifra que
     * ninguna política emitió.
     */
    const approvedLimit = num(output.approved_credit_limit ?? response.limit) ?? 0;

    return this.escritor.persist({
      tenantId: input.tenantId,
      customerId: input.customerId,
      trigger: input.trigger,
      now,
      values: {
        approvedLimit,
        maxAffordableInstallment: num(output.max_affordable_installment),
        disposableIncome: num(variables.disposable_income),
        scoring: num(output.scoring ?? response.score),
        creditRiskScore: num(output.credit_risk_score),
        riskBand: str(output.risk_band ?? response.riskBand),
        pricingTier: str(output.pricing_tier),
        annualPercentageRate: num(output.annual_percentage_rate),
        affordabilityScore: num(output.affordability_score),
        affordabilityDecision: str(output.affordability_decision),
        probabilityOfDefault: num(output.probability_of_default),
        capacity,
        decisionOutcome: str(output.decision_outcome ?? response.outcome) ?? response.status,
        decisionExecutionId: response.executionId,
        artifactCode: response.artifact?.code ?? env.DECISION_ENGINE_CREDIT_ARTIFACT,
        artifactVersionId: response.artifact?.versionId ?? null,
        reasonCodes: response.reasonCodes,
        provenance,
      },
    });
  }
}
