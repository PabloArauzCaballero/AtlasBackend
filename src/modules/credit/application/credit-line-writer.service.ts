/**
 * @file La escritura de una línea nueva: cierra la vigente y abre la siguiente, en la misma transacción.
 * @business Esta pieza sostiene la operación diaria del backend.
 * @system implementa este tramo del módulo.
 */
import { DecisionArtifactBindingService } from '../../decision-engine/decision-artifact-binding.service.js';
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { CreditLineModel } from '../../../database/models/index.js';
import { DecisionEngineClient } from '../../decision-engine/decision-engine.client.js';
import { SubjectReferenceService } from '../../decision-engine/subject-reference.service.js';
import { UnderwritingFeaturesService } from '../../decision-engine/underwriting-features.service.js';
import type { PaymentCapacityAssessment } from '../domain/payment-capacity.js';
import { PaymentCapacityService } from './payment-capacity.service.js';

/** Qué movió la línea. Se escribe siempre: una bajada sin causa visible parece un error. */
export type CalculationTrigger = 'onboarding' | 'bank_statement' | 'delinquency' | 'repayment' | 'manual' | 'application';

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

/**
 * Sale de `CreditLineRecalculationService` porque son dos cosas distintas: DECIDIR la cifra
 * —capacidad, riesgo, política— y ESCRIBIRLA sin dejar un instante con dos líneas vigentes o con
 * ninguna. La segunda es corta y no cambia cuando cambia la política.
 */
@Injectable()
export class CreditLineWriterService {
  constructor(
    @InjectModel(CreditLineModel) private readonly creditLines: typeof CreditLineModel,
    private readonly artifactBindings: DecisionArtifactBindingService,
    private readonly features: UnderwritingFeaturesService,
    private readonly client: DecisionEngineClient,
    private readonly subjects: SubjectReferenceService,
    private readonly capacity: PaymentCapacityService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Cierra la vigente y abre la nueva, en la misma transacción.
   *
   * Las dos escrituras van juntas porque el índice único parcial sólo admite UNA línea sin
   * `valid_until`: separarlas dejaría un instante con dos vigentes —que la base rechaza— o con
   * ninguna —en el que la app le diría al cliente que no tiene crédito—.
   */
  persist(input: {
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
      capacity: PaymentCapacityAssessment;
      decisionOutcome: string;
      decisionExecutionId: string | null;
      artifactCode: string | null;
      artifactVersionId: string | null;
      reasonCodes: unknown[];
      provenance: Record<string, string>;
    };
  }): Promise<CreditLineModel> {
    return this.sequelize.transaction(async (transaction) => {
      const previous = await this.lineaVigente(input.tenantId, input.customerId, { transaction });
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
          recommendedLimit: values.capacity.recommendedLimit.toFixed(2),
          capacityJson: values.capacity as unknown as Record<string, unknown>,
          relationshipScore: values.capacity.relationshipScore,
          relationshipTier: values.capacity.relationshipTier,
          capacityBinding: values.capacity.bindingConstraint,
          capacityEvidence: values.capacity.evidence,
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

  /**
   * La línea vigente. Se lee aquí y no a través de `CreditLineService` a propósito: inyectarlo
   * crearía una dependencia mutua entre los dos servicios, y Nest la rechaza al arrancar salvo con
   * `forwardRef`. Es una consulta de cuatro líneas contra el mismo modelo que este servicio ya
   * tiene inyectado.
   */
  lineaVigente(tenantId: string, customerId: string, options: { transaction?: Transaction } = {}): Promise<CreditLineModel | null> {
    return this.creditLines.findOne({
      where: { tenantId, customerId, validUntil: null, deleted: false },
      transaction: options.transaction,
    } as FindOptions);
  }
}
