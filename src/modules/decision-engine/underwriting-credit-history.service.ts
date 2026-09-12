/**
 * @file El historial de crédito del cliente, tal como entra en la decisión.
 * @business Cómo ha pagado antes es la señal que más pesa, y por eso se lee aparte.
 * @system agrega préstamos y cuotas del cliente en los rasgos de comportamiento de pago.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { LoanModel, LoanInstallmentModel } from '../../database/models/index.js';
import { clamp, DELINQUENCY_MAP, toNumber } from './underwriting-numbers.js';

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
  ) {}

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
    const loans = await this.loans.findAll({ where: { tenantId, customerId } } as FindOptions);
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
        applications6m: 0,
        applications24h: 0,
      };
    }

    const schedule = await this.installments.findAll({
      where: { tenantId, loanId: { [Op.in]: loans.map((loan) => String(loan.id)) } },
    } as FindOptions);

    const today = now.toISOString().slice(0, 10);
    const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);

    let overdueInLastYear = 0;
    let worstDaysLate = 0;
    let settledOnTime = 0;
    let settledLate = 0;
    let pendingMonthly = 0;

    for (const instalment of schedule) {
      const paid = instalment.status === 'paid';
      const late = instalment.dueDate < today && !paid;

      if (late && instalment.dueDate >= yearAgo) overdueInLastYear += 1;
      if (late) {
        const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${instalment.dueDate}T00:00:00Z`)) / 86_400_000);
        worstDaysLate = Math.max(worstDaysLate, days);
      }
      if (paid) {
        if (toNumber(instalment.daysPastDue) > 0) settledLate += 1;
        else settledOnTime += 1;
      }
      if (!paid) pendingMonthly += toNumber(instalment.principalAmount) + toNumber(instalment.interestAmount);
    }

    const worstBucket = loans
      .map((loan) => String(loan.delinquencyBucket ?? 'current'))
      .sort()
      .reverse()[0];

    const settled = settledOnTime + settledLate;
    const paymentHistoryScore = settled > 0 ? clamp(Math.round((settledOnTime / settled) * 100), 0, 100) : 50;

    const disbursedDates = loans.map((loan) => loan.disbursedAt).filter((date): date is Date => Boolean(date));
    const oldest = disbursedDates.length > 0 ? Math.min(...disbursedDates.map((date) => new Date(date).getTime())) : now.getTime();

    return {
      loanCount: loans.length,
      delinquencyCount12m: overdueInLastYear,
      worstStatus: this.worstStatusOf(worstDaysLate, worstBucket),
      chargeOffCount: loans.filter((loan) => loan.status === 'written_off').length,
      oldestTradeAgeMonths: Math.max(0, Math.floor((now.getTime() - oldest) / (30.44 * 86_400_000))),
      utilization: 0,
      paymentHistoryScore,
      // El compromiso mensual pendiente entra en la relación deuda-ingreso: quien ya tiene tres
      // cuotas corriendo no dispone del mismo sueldo que quien no tiene ninguna.
      monthlyCommitted: Math.round((pendingMonthly / Math.max(1, loans.length * 3)) * 100) / 100,
      applications6m: loans.length,
      applications24h: loans.filter((loan) => loan.disbursedAt && now.getTime() - new Date(loan.disbursedAt).getTime() < 86_400_000).length,
    };
  }

  /** El peor tramo, medido contra el calendario y contrastado con el que dejó el barrido. */
  worstStatusOf(worstDaysLate: number, bucket: string | undefined): string {
    if (worstDaysLate >= 120) return 'DPD_120_PLUS';
    if (worstDaysLate >= 90) return 'DPD_90';
    if (worstDaysLate >= 60) return 'DPD_60';
    if (worstDaysLate >= 1) return 'DPD_30';
    return DELINQUENCY_MAP[String(bucket ?? 'current').toLowerCase()] ?? 'CURRENT';
  }
}
