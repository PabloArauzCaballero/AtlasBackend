/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza fija cuánto puede gastar el cliente, y deja escrito por qué es esa cifra.
 * @system pide la línea al motor con el expediente real y la persiste versionada con su traza.
 */
import { DecisionArtifactBindingService } from '../../decision-engine/decision-artifact-binding.service.js';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { randomUUID } from 'node:crypto';
import { FindOptions, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../../config/env.js';
import { CreditLineModel } from '../../../database/models/index.js';
import { DecisionEngineClient } from '../../decision-engine/decision-engine.client.js';
import { CREDIT_DECISION_PURPOSE, SubjectReferenceService } from '../../decision-engine/subject-reference.service.js';
import { UnderwritingFeaturesService } from '../../decision-engine/underwriting-features.service.js';

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
@Injectable()
export class CreditLineService {
  private readonly logger = new Logger(CreditLineService.name);

  constructor(
    @InjectModel(CreditLineModel) private readonly creditLines: typeof CreditLineModel,
    private readonly artifactBindings: DecisionArtifactBindingService,
    private readonly features: UnderwritingFeaturesService,
    private readonly client: DecisionEngineClient,
    private readonly subjects: SubjectReferenceService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /** La vigente, o `null` si el cliente todavía no tiene ninguna calculada. */
  current(tenantId: string, customerId: string, options: { transaction?: Transaction } = {}): Promise<CreditLineModel | null> {
    return this.creditLines.findOne({
      where: { tenantId, customerId, validUntil: null, deleted: false },
      transaction: options.transaction,
    } as FindOptions);
  }

  /** El historial completo, de la más reciente a la más antigua. Es el «por qué me bajó». */
  history(tenantId: string, customerId: string, limit = 12): Promise<CreditLineModel[]> {
    return this.creditLines.findAll({
      where: { tenantId, customerId, deleted: false },
      order: [['valid_from', 'DESC']],
      limit,
    } as FindOptions);
  }

  async requireCurrent(tenantId: string, customerId: string): Promise<CreditLineModel> {
    const line = await this.current(tenantId, customerId);
    if (!line) throw new NotFoundException('CREDIT_LINE_NOT_CALCULATED');
    return line;
  }

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

    const { variables, provenance } = await this.features.build({
      tenantId: input.tenantId,
      customerId: input.customerId,
      requestedAmount,
      requestedTermMonths,
      bankStatementNsfCount: input.bankStatementNsfCount ?? null,
      now,
    });

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

    return this.persist({
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
        decisionOutcome: str(output.decision_outcome ?? response.outcome) ?? response.status,
        decisionExecutionId: response.executionId,
        artifactCode: response.artifact?.code ?? env.DECISION_ENGINE_CREDIT_ARTIFACT,
        artifactVersionId: response.artifact?.versionId ?? null,
        reasonCodes: response.reasonCodes,
        provenance,
      },
    });
  }

  /**
   * Cierra la vigente y abre la nueva, en la misma transacción.
   *
   * Las dos escrituras van juntas porque el índice único parcial sólo admite UNA línea sin
   * `valid_until`: separarlas dejaría un instante con dos vigentes —que la base rechaza— o con
   * ninguna —en el que la app le diría al cliente que no tiene crédito—.
   */
  private persist(input: {
    tenantId: string;
    customerId: string;
    trigger: CalculationTrigger;
    now: Date;
    values: {
      approvedLimit: number;
      maxAffordableInstallment: number | null;
      disposableIncome: number | null;
      scoring: number | null;
      creditRiskScore: number | null;
      riskBand: string | null;
      pricingTier: string | null;
      annualPercentageRate: number | null;
      affordabilityScore: number | null;
      affordabilityDecision: string | null;
      probabilityOfDefault: number | null;
      decisionOutcome: string;
      decisionExecutionId: string | null;
      artifactCode: string | null;
      artifactVersionId: string | null;
      reasonCodes: unknown[];
      provenance: Record<string, string>;
    };
  }): Promise<CreditLineModel> {
    return this.sequelize.transaction(async (transaction) => {
      const previous = await this.current(input.tenantId, input.customerId, { transaction });
      if (previous) {
        previous.validUntil = input.now;
        previous.updatedAtValue = input.now;
        await previous.save({ transaction });
      }

      const values = input.values;
      return this.creditLines.create(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          currencyCode: 'BOB',
          approvedLimit: values.approvedLimit.toFixed(2),
          maxAffordableInstallment: values.maxAffordableInstallment?.toFixed(2) ?? null,
          disposableIncome: values.disposableIncome?.toFixed(2) ?? null,
          scoring: values.scoring === null ? null : Math.round(values.scoring),
          creditRiskScore: values.creditRiskScore === null ? null : Math.round(values.creditRiskScore),
          riskBand: values.riskBand,
          pricingTier: values.pricingTier,
          annualPercentageRate: values.annualPercentageRate?.toFixed(2) ?? null,
          affordabilityScore: values.affordabilityScore === null ? null : Math.round(values.affordabilityScore),
          affordabilityDecision: values.affordabilityDecision,
          probabilityOfDefault: values.probabilityOfDefault?.toFixed(4) ?? null,
          decisionOutcome: values.decisionOutcome,
          decisionExecutionId: values.decisionExecutionId,
          artifactCode: values.artifactCode,
          artifactVersionId: values.artifactVersionId,
          reasonCodesJson: values.reasonCodes,
          provenanceJson: values.provenance,
          calculationTrigger: input.trigger,
          validFrom: input.now,
          validUntil: null,
          supersedesCreditLineId: previous?.id ?? null,
          createdAtValue: input.now,
          updatedAtValue: input.now,
          deleted: false,
        },
        { transaction },
      );
    });
  }
}
