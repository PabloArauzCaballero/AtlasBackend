/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza fija cuánto puede gastar el cliente, y deja escrito por qué es esa cifra.
 * @system pide la línea al motor con el expediente real y la persiste versionada con su traza.
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { FindOptions, Transaction } from 'sequelize';

import { CreditLineModel } from '../../../database/models/index.js';

import type { PaymentCapacityAssessment } from '../domain/payment-capacity.js';

import { CreditLineRecalculationService } from './credit-line-recalculation.service.js';

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
@Injectable()
export class CreditLineService {
  private readonly logger = new Logger(CreditLineService.name);

  constructor(
    @InjectModel(CreditLineModel) private readonly creditLines: typeof CreditLineModel,
    private readonly recalculo: CreditLineRecalculationService,
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
   * El recálculo vive en `CreditLineRecalculationService`. Se re-expone aquí para no obligar a
   * cambiar de servicio a quien ya llamaba `creditLine.recalculate(...)`.
   */
  recalculate(input: Parameters<CreditLineRecalculationService['recalculate']>[0]): Promise<CreditLineModel | null> {
    return this.recalculo.recalculate(input);
  }
}

/**
 * La propuesta de capacidad, traducida al vocabulario del artefacto.
 *
 * Se manda el DESGLOSE y no sólo la cifra: una política que sólo recibe «propongo 4.500» no puede
 * hacer nada distinto de aceptarla o ignorarla, mientras que con la cuota sostenible, el tramo de
 * relación y el techo que mordió puede decidir con criterio propio —por ejemplo, no conceder a un
 * tramo NUEVO por encima de cierto importe aunque el extracto lo soporte—.
 */
export function capacityVariables(capacity: PaymentCapacityAssessment): Record<string, unknown> {
  return {
    capacity_recommended_limit: capacity.recommendedLimit,
    capacity_monthly_installment: capacity.monthlyInstallment,
    capacity_binding_constraint: capacity.bindingConstraint,
    capacity_evidence_source: capacity.evidence,
    relationship_score: capacity.relationshipScore,
    relationship_tier: capacity.relationshipTier,
    tenure_score: capacity.components.tenure,
    loyalty_score: capacity.components.loyalty,
  };
}

/**
 * De dónde salió cada una.
 *
 * Con extracto son datos OBSERVADOS del cliente; sin él son derivados de lo declarado, y la
 * diferencia tiene que llegar al expediente: es lo que después distingue «tu capacidad se midió con
 * tus movimientos» de «se estimó con lo que declaraste», que son dos afirmaciones muy distintas
 * sobre la misma cifra.
 */
export function capacityProvenance(capacity: PaymentCapacityAssessment): Record<string, 'expediente' | 'derivado' | 'ausente'> {
  const origen = capacity.evidence === 'EXTRACTO' ? 'expediente' : 'derivado';
  return {
    capacity_recommended_limit: origen,
    capacity_monthly_installment: origen,
    capacity_binding_constraint: 'derivado',
    capacity_evidence_source: 'derivado',
    relationship_score: 'derivado',
    relationship_tier: 'derivado',
    tenure_score: 'expediente',
    loyalty_score: 'expediente',
  };
}
