/**
 * @file El historial de crédito del cliente, tal como entra en la decisión.
 * @business Cómo ha pagado antes es la señal que más pesa, y por eso se lee aparte.
 * @system agrega préstamos y cuotas del cliente en los rasgos de comportamiento de pago.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { CreditApplicationModel, LoanModel, LoanInstallmentModel } from '../../database/models/index.js';
import { clamp, DELINQUENCY_SEVERITY, toNumber, worstDelinquencyOf } from './underwriting-numbers.js';

const DAY_MS = 86_400_000;
/** Ventana de las solicitudes rechazadas que cuentan como «consultas» (`inquiries_last_6m`). */
const INQUIRY_WINDOW_DAYS = 182;

/**
 * Sale de `UnderwritingSignalsService` porque es la única señal que se calcula agregando dos
 * tablas propias en vez de leer un atributo, y entre las dos pasaban del límite de
 * `check:file-size`.
 */
@Injectable()
export class UnderwritingCreditHistoryService {
  constructor(
    @InjectModel(LoanModel) private readonly loans: typeof LoanModel,
    @InjectModel(LoanInstallmentModel) private readonly installments: typeof LoanInstallmentModel,
    @InjectModel(CreditApplicationModel) private readonly applications: typeof CreditApplicationModel,
  ) {}

  /**
   * Las dos cuentas de solicitudes que entran como «consultas» y «velocidad».
   *
   * Hasta 2026-10 las dos se sacaban de los PRÉSTAMOS: `inquiries_last_6m` era el número de créditos de por
   * vida y la velocidad, los desembolsados en 24 h. Así el cliente que más volvía —el que el producto quiere—
   * era el que más puntos de riesgo sumaba: con ocho créditos pagados a tiempo puntuaba como uno recién llegado.
   *
   * Sin buró externo, la única «consulta» que dice algo es la que Atlas RECHAZÓ: alguien que insiste después de un
   * no. La velocidad cuenta todas las solicitudes del día, y el artefacto (2.2.0) sólo la castiga por encima de tres.
   */
  async applicationCounts(tenantId: string, customerId: string, now: Date): Promise<{ rejected6m: number; submitted24h: number }> {
    const [rejected6m, submitted24h] = await Promise.all([
      this.applications.count({
        where: {
          tenantId,
          customerId,
          deleted: false,
          status: 'rejected',
          submittedAt: { [Op.gte]: new Date(now.getTime() - INQUIRY_WINDOW_DAYS * DAY_MS) },
        },
      } as FindOptions),
      this.applications.count({
        where: { tenantId, customerId, deleted: false, submittedAt: { [Op.gte]: new Date(now.getTime() - DAY_MS) } },
      } as FindOptions),
    ]);
    return { rejected6m, submitted24h };
  }

  /**
   * El historial de pago del cliente DENTRO de Atlas.
   *
   * Es lo único que se sabe con certeza sobre cómo paga, y por eso pesa: sustituye a un buró que
   * aquí no existe. El peor tramo de mora y el número de moras en doce meses son entradas directas
   * del artefacto, y son las que hacen que entrar en mora cueste puntaje.
   */
  async creditHistory(
    tenantId: string,
    customerId: string,
    now: Date,
  ): Promise<{
    loanCount: number;
    delinquencyCount12m: number;
    worstStatus: string;
    chargeOffCount: number;
    oldestTradeAgeMonths: number;
    utilization: number;
    paymentHistoryScore: number;
    monthlyCommitted: number;
    applications6m: number;
    applications24h: number;
  }> {
    // Las filas borradas no son historial (mismo criterio que `payment-capacity.service.ts`).
    const [loans, counts] = await Promise.all([
      this.loans.findAll({ where: { tenantId, customerId, deleted: false } } as FindOptions),
      this.applicationCounts(tenantId, customerId, now),
    ]);
    if (loans.length === 0) {
      return {
        loanCount: 0,
        delinquencyCount12m: 0,
        worstStatus: 'CURRENT',
        chargeOffCount: 0,
        oldestTradeAgeMonths: 0,
        utilization: 0,
        // Sin historial NO se parte de cero: cero es «paga fatal», y quien no ha pedido nunca no
        // paga fatal, simplemente no ha pagado. Se parte de un valor medio y la política decide.
        paymentHistoryScore: 50,
        monthlyCommitted: 0,
        applications6m: counts.rejected6m,
        applications24h: counts.submitted24h,
      };
    }

    const schedule = await this.installments.findAll({
      where: { tenantId, deleted: false, loanId: { [Op.in]: loans.map((loan) => String(loan.id)) } },
    } as FindOptions);

    const { overdueInLastYear, worstDaysLate, settledOnTime, settledLate, monthlyCommitted } = scheduleFacts(schedule, now);

    const settled = settledOnTime + settledLate;
    const paymentHistoryScore = settled > 0 ? clamp(Math.round((settledOnTime / settled) * 100), 0, 100) : 50;

    const disbursedDates = loans.map((loan) => loan.disbursedAt).filter((date): date is Date => Boolean(date));
    const oldest = disbursedDates.length > 0 ? Math.min(...disbursedDates.map((date) => new Date(date).getTime())) : now.getTime();

    return {
      loanCount: loans.length,
      delinquencyCount12m: overdueInLastYear,
      worstStatus: this.worstStatusOf(
        worstDaysLate,
        loans.map((loan) => loan.delinquencyBucket),
      ),
      chargeOffCount: loans.filter((loan) => loan.status === 'written_off').length,
      oldestTradeAgeMonths: Math.max(0, Math.floor((now.getTime() - oldest) / (30.44 * DAY_MS))),
      utilization: 0,
      paymentHistoryScore,
      // El compromiso mensual pendiente entra en la relación deuda-ingreso: quien ya tiene tres
      // cuotas corriendo no dispone del mismo sueldo que quien no tiene ninguna.
      monthlyCommitted: Math.round(monthlyCommitted * 100) / 100,
      applications6m: counts.rejected6m,
      applications24h: counts.submitted24h,
    };
  }

  /**
   * El peor tramo, medido contra el calendario y contrastado con el que dejó el barrido.
   *
   * Gana el más GRAVE de los dos: un préstamo castigado con una cuota impaga de 40 días es un castigo, no un
   * `DPD_30`. Antes los días mandaban siempre y el tramo del barrido sólo contaba con cero días de atraso.
   */
  worstStatusOf(worstDaysLate: number, buckets: readonly (string | null | undefined)[]): string {
    const byDays =
      worstDaysLate >= 120
        ? 'DPD_120_PLUS'
        : worstDaysLate >= 90
          ? 'DPD_90'
          : worstDaysLate >= 60
            ? 'DPD_60'
            : worstDaysLate >= 1
              ? 'DPD_30'
              : 'CURRENT';
    const byBucket = worstDelinquencyOf(buckets);
    return (DELINQUENCY_SEVERITY[byBucket] ?? 0) > (DELINQUENCY_SEVERITY[byDays] ?? 0) ? byBucket : byDays;
  }
}

/**
 * Lo que dice el calendario de cuotas: moras del año, peor atraso, pagadas a tiempo o tarde, y la cuota del mes.
 *
 * El compromiso mensual es la PRÓXIMA cuota impaga de cada préstamo. Antes era todo lo impago dividido entre
 * (préstamos × 3), contando también los préstamos ya pagados: con ocho créditos cerrados y uno vivo, la cuota
 * real quedaba dividida entre 27 y la deuda-ingreso salía casi en cero.
 */
export function scheduleFacts(
  schedule: readonly Pick<LoanInstallmentModel, 'loanId' | 'status' | 'dueDate' | 'daysPastDue' | 'principalAmount' | 'interestAmount'>[],
  now: Date,
): { overdueInLastYear: number; worstDaysLate: number; settledOnTime: number; settledLate: number; monthlyCommitted: number } {
  const today = now.toISOString().slice(0, 10);
  const yearAgo = new Date(now.getTime() - 365 * DAY_MS).toISOString().slice(0, 10);
  let overdueInLastYear = 0;
  let worstDaysLate = 0;
  let settledOnTime = 0;
  let settledLate = 0;
  const nextDue = new Map<string, { dueDate: string; amount: number }>();

  for (const instalment of schedule) {
    const paid = instalment.status === 'paid';
    if (paid) {
      if (toNumber(instalment.daysPastDue) > 0) settledLate += 1;
      else settledOnTime += 1;
      continue;
    }
    if (instalment.dueDate < today) {
      if (instalment.dueDate >= yearAgo) overdueInLastYear += 1;
      const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${instalment.dueDate}T00:00:00Z`)) / DAY_MS);
      worstDaysLate = Math.max(worstDaysLate, days);
    }
    const loanId = String(instalment.loanId);
    const known = nextDue.get(loanId);
    if (!known || instalment.dueDate < known.dueDate) {
      nextDue.set(loanId, {
        dueDate: instalment.dueDate,
        amount: toNumber(instalment.principalAmount) + toNumber(instalment.interestAmount),
      });
    }
  }
  const monthlyCommitted = [...nextDue.values()].reduce((sum, due) => sum + due.amount, 0);
  return { overdueInLastYear, worstDaysLate, settledOnTime, settledLate, monthlyCommitted };
}
