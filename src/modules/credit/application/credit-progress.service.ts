/**
 * @file Caso de uso: el nivel de un cliente y su evolución.
 * @business Responde «¿en qué nivel estoy, cuánto me falta para el siguiente y qué hago para subir?». Es lo que convierte el puntaje en algo que se mueve con la conducta.
 * @system compone `PaymentCapacityService` (nivel, desde la base de datos) con el historial de versiones de la línea; no llama al motor.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { LoanInstallmentModel } from '../../../database/models/loan-installments.model.js';
import { LoanModel } from '../../../database/models/loans.model.js';
import { buildExperience } from '../domain/experience.js';
import { toCustomerCardResponse } from '../card-tier.mapper.js';
import { buildPointsLevel } from '../domain/points-level.js';
import { toPaymentPoints, toPayerRating } from '../domain/payer-rating.js';
import { CardTierService } from './card-tier.service.js';
import { buildRelationshipProgress } from '../domain/relationship-progress.js';
import { CreditLineService } from './credit-line.service.js';
import { PaymentCapacityService } from './payment-capacity.service.js';

/** Cuántas versiones de la línea se enseñan en la evolución. */
const HISTORY_LIMIT = 12;
/** Los créditos cuya compra suma experiencia: concretada (`active`) o ya pagada (`paid_off`). */
const COMPRAS_CON_EXPERIENCIA = new Set(['active', 'paid_off']);

@Injectable()
export class CreditProgressService {
  constructor(
    private readonly capacity: PaymentCapacityService,
    private readonly lines: CreditLineService,
    private readonly cards: CardTierService,
    @InjectModel(LoanModel) private readonly loans: typeof LoanModel,
    @InjectModel(LoanInstallmentModel) private readonly installments: typeof LoanInstallmentModel,
  ) {}

  /**
   * Las cuotas del cliente, tal como las necesita la experiencia: vencimiento, estado, atraso y lo pagado
   * (capital + intereses; el recargo por mora NO cuenta, porque pagar tarde no debe sumar).
   */
  private async installmentFacts(tenantId: string, customerId: string) {
    const loans = await this.loans.findAll({
      where: { tenantId, customerId },
      attributes: ['id', 'status', 'principalAmount'],
    } as FindOptions);
    if (loans.length === 0) return { facts: [], loansEver: 0, purchaseAmounts: [] };
    const schedule = await this.installments.findAll({
      where: { tenantId, loanId: { [Op.in]: loans.map((loan) => String(loan.id)) }, deleted: false },
    } as FindOptions);
    return {
      loansEver: loans.length,
      // La experiencia: 1 punto por boliviano comprado. Sólo compras concretadas y no castigadas (`domain/experience.ts`).
      purchaseAmounts: loans
        .filter((loan) => COMPRAS_CON_EXPERIENCIA.has(String(loan.status)))
        .map((loan) => Number(loan.principalAmount ?? 0)),
      facts: schedule.map((cuota) => ({
        dueDate: String(cuota.dueDate),
        status: String(cuota.status),
        daysPastDue: Number(cuota.daysPastDue ?? 0),
        paidAmount: Number(cuota.paidPrincipal ?? 0) + Number(cuota.paidInterest ?? 0),
      })),
    };
  }

  /**
   * El nivel NO depende de que exista una línea de crédito calculada.
   *
   * Sale de la base de datos —antigüedad, pagos, compras cerradas, identidad—, no del motor. Así quien todavía
   * no tiene línea (porque el motor aún no decidió, o el extracto está en revisión) ve igual dónde está y qué
   * le falta, en vez de una pantalla vacía que parece un fallo.
   */
  /**
   * Sólo el nivel, sin historial: lo que necesita quien únicamente quiere saber en qué escalón está (la tarjeta
   * automática sale de aquí). Misma cuenta que `get`; no es otra regla. Lee las cuotas porque el nivel se mide en
   * PUNTOS, y los puntos salen de lo comprado.
   */
  async levelOf(tenantId: string, customerId: string) {
    const current = await this.lines.current(tenantId, customerId);
    const [{ assessment, relationship }, cuotas] = await Promise.all([
      this.capacity.assessDetailed({
        tenantId,
        customerId,
        declaredMonthlyIncome: null,
        currentLimit: current ? Number(current.approvedLimit) : null,
      }),
      this.installmentFacts(tenantId, customerId),
    ]);
    const experiencia = this.experienceOf(cuotas, relationship);
    return { ...buildRelationshipProgress(assessment, relationship), ...buildPointsLevel(experiencia.xp) };
  }

  private experienceOf(
    cuotas: Awaited<ReturnType<CreditProgressService['installmentFacts']>>,
    relationship: { loansSettled: number; kycComplete: boolean; tenureMonths: number },
  ) {
    return buildExperience({
      installments: cuotas.facts,
      purchaseAmounts: cuotas.purchaseAmounts,
      loansEver: cuotas.loansEver,
      loansSettled: relationship.loansSettled,
      kycComplete: relationship.kycComplete,
      tenureMonths: relationship.tenureMonths,
      today: new Date().toISOString().slice(0, 10),
    });
  }

  async get(tenantId: string, customerId: string) {
    const current = await this.lines.current(tenantId, customerId);
    const [{ assessment, relationship }, history, cuotas] = await Promise.all([
      this.capacity.assessDetailed({
        tenantId,
        customerId,
        declaredMonthlyIncome: null,
        currentLimit: current ? Number(current.approvedLimit) : null,
      }),
      this.lines.history(tenantId, customerId, HISTORY_LIMIT),
      this.installmentFacts(tenantId, customerId),
    ]);

    const progreso = buildRelationshipProgress(assessment, relationship);
    const experiencia = this.experienceOf(cuotas, relationship);
    // El NIVEL se mide en puntos (lo comprado), no en la calificación: ver `domain/points-level.ts`.
    const nivel = buildPointsLevel(experiencia.xp);
    // La tarjeta: la que gana por su nivel o la que el personal le puso. Es presentación y estatus; no toca el límite.
    const [tarjeta, catalogo] = await Promise.all([
      this.cards.resolveFor(tenantId, customerId, nivel.level.code),
      this.cards.catalog(tenantId),
    ]);

    return {
      customerId,
      hasCreditLine: current !== null,
      ...progreso,
      card: toCustomerCardResponse(tarjeta, catalogo),
      // Calificación 1-100 (qué tan buen pagador) y Puntaje (puntos de experiencia por comprar), con sus nombres de negocio.
      ...nivel,
      rating: toPayerRating(progreso.score),
      points: toPaymentPoints(experiencia),
      // Puntos por boliviano COMPRADO, rachas e insignias de pago.
      experience: experiencia,

      signals: {
        tenureMonths: relationship.tenureMonths,
        loansSettled: relationship.loansSettled,
        loansActive: relationship.loansActive,
        onTimeRatio: relationship.onTimeRatio,
        kycComplete: relationship.kycComplete,
      },
      // De la más reciente a la más antigua, como el resto del historial de la línea.
      history: history.map((line) => ({
        validFrom: line.validFrom,
        trigger: line.calculationTrigger,
        scoring: line.scoring,
        approvedLimit: Number(line.approvedLimit),
        relationshipScore: line.relationshipScore,
        relationshipTier: line.relationshipTier,
      })),
    };
  }
}
