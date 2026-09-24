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
import { SubjectReferenceService } from '../../decision-engine/subject-reference.service.js';
import { lineVariableMetadata, UnderwritingFeaturesService } from '../../decision-engine/underwriting-features.service.js';
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

/** La respuesta del motor, tal como la devuelve el cliente (sin abrir otra dependencia a su módulo). */
type EngineDecision = Awaited<ReturnType<DecisionEngineClient['execute']>>;

/**
 * Qué límite puede escribirse con esta respuesta, o por qué ninguno (P-10).
 *
 * Aprobación limpia → el límite emitido, que debe ser finito y no negativo. Rechazo → 0, que es lo
 * que la política dijo. Cualquier otra cosa → no se escribe: la línea vigente sigue valiendo.
 */
export function usableLimit(
  response: EngineDecision,
  output: Record<string, unknown>,
): { write: true; approvedLimit: number } | { write: false; reason: string } {
  const verdict = DecisionEngineClient.verdictOf(response);
  if (verdict.kind === 'declined') return { write: true, approvedLimit: 0 };
  if (verdict.kind === 'review') return { write: false, reason: verdict.reason };
  const raw = output.approved_credit_limit ?? response.limit;
  const limit = raw === null || raw === undefined ? null : num(raw);
  if (limit === null || limit < 0) return { write: false, reason: `INVALID_ECONOMIC_OUTPUT:approved_credit_limit=${String(raw)}` };
  return { write: true, approvedLimit: limit };
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
    const features = await this.features.build({
      tenantId: input.tenantId,
      customerId: input.customerId,
      requestedAmount,
      requestedTermMonths,
      bankStatementNsfCount: input.bankStatementNsfCount ?? null,
      now,
    });
    const { variables, provenance } = features;

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

    /*
     * La base habilitante, en el motor ANTES de preguntar (P-09). Antes se registraba DESPUÉS de la
     * decisión porque el motor no conocía al titular hasta su primera decisión; ahora el alta de la
     * base lo materializa, y el motor sin base no decide (422 `ENABLING_BASIS_MISSING`). Si no llega,
     * la línea vigente no se toca y el próximo recálculo lo vuelve a intentar: la réplica queda en la
     * cola duradera. La base es `CREDIT_PROTECTION` y no `CONSENT`: ver `underwriting-basis.ts`.
     */
    const basis = await this.client.ensureUnderwritingBasis({
      tenantId: input.tenantId,
      customerId: input.customerId,
      subjectReference,
      now,
    });
    const blocked = DecisionEngineClient.basisBlocker(basis);
    if (blocked) {
      this.logger.warn(`No se recalcula la línea del cliente ${input.customerId}: ${blocked.reason} (${basis.error ?? basis.status}).`);
      return null;
    }

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
        variableMetadata: lineVariableMetadata(features, capacity.evidence),
        context: { source: 'atlas-backend', purpose: 'credit_line', trigger: input.trigger, provenance },
      });
    } catch (error) {
      this.logger.error(`El motor no pudo recalcular la línea del cliente ${input.customerId}: ${(error as Error).message}`);
      return null;
    }

    const output = (response.output ?? {}) as Record<string, unknown>;

    /*
     * El límite se lee del artefacto y no se corrige aquí (P-10). Sólo una aprobación LIMPIA escribe
     * el límite que emitió; un rechazo escribe cero; y una respuesta técnica —ejecución sin terminar,
     * motivo técnico, caso de revisión abierto o un límite negativo o no finito— NO toca la línea
     * vigente: un bug del artefacto no puede convertirse en un recorte de crédito del cliente, ni en
     * un cupo inventado.
     */
    const usable = usableLimit(response, output);
    if (usable.write === false) {
      this.logger.warn(`La línea del cliente ${input.customerId} no se toca: ${usable.reason} (ejecución ${response.executionId}).`);
      return null;
    }
    const approvedLimit = usable.approvedLimit;

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
