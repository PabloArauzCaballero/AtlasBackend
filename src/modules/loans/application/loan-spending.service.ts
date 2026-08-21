/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza dice en qué gasta el cliente, por rubro y por comercio, con lo que de verdad debe.
 * @system agrega el libro de préstamos por categoría de comercio y por comercio.
 */
import { Injectable } from '@nestjs/common';
import { LoanInstallmentModel, LoanModel } from '../../../database/models/index.js';
import { PartnerProfileService } from '../../partner-onboarding/application/partner-profile.service.js';
import { LoansRepository } from '../loans.repository.js';

/** Lo que se cuenta de un grupo, sea un rubro o un comercio. */
interface SpendTotals {
  financed: number;
  paid: number;
  outstanding: number;
  overdue: number;
  upcoming: number;
  loanCount: number;
  overdueLoanCount: number;
}

const EMPTY: SpendTotals = { financed: 0, paid: 0, outstanding: 0, overdue: 0, upcoming: 0, loanCount: 0, overdueLoanCount: 0 };

/**
 * El rubro de quien no lo declaró.
 *
 * Se nombra explícitamente en vez de dejar la clave vacía porque la pantalla tiene que poder
 * distinguir «no sabemos el rubro» de «no hay comercio». Son dos ausencias distintas: la primera es
 * un expediente incompleto, la segunda un crédito anterior al vínculo.
 */
const SIN_RUBRO = 'sin_rubro';
const SIN_COMERCIO = 'sin_comercio';

function toNumber(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * En qué gasta el cliente.
 *
 * ## Por qué se calcula en el servidor y no en el teléfono
 *
 * Porque el reparto por rubro decide lo que el cliente cree de sí mismo —«gasto la mitad en
 * electrónica»— y ese número tiene que salir del mismo sitio del que salen sus cuotas. Calcularlo
 * en el dispositivo obliga a bajar el libro entero, y dos teléfonos con versiones distintas de la
 * app enseñarían dos repartos distintos del mismo dinero.
 *
 * ## Qué se cuenta como gasto
 *
 * El **capital financiado**, no el precio de la compra. Es lo que Atlas prestó y lo que el cliente
 * devuelve; sumar la parte que ya pagó de su bolsillo mezclaría dos cosas que él vive por separado.
 *
 * Lo vencido y lo que está por vencer salen del CALENDARIO, no del estado del préstamo: un préstamo
 * al corriente puede tener una cuota que vence mañana, y esa es justamente la que hay que enseñar.
 */
@Injectable()
export class LoanSpendingService {
  constructor(
    private readonly loans: LoansRepository,
    private readonly partnerProfiles: PartnerProfileService,
  ) {}

  /**
   * En qué rubro y bajo qué comercio cae un préstamo.
   *
   * Son cuatro decisiones encadenadas —¿tiene comercio?, ¿ese comercio declara rubro?, ¿con qué
   * nombre se enseña?— y juntas eran la mitad de la complejidad del método que las contenía.
   * Aparte se leen como lo que son: la regla de imputación, que es la que hay que mirar cuando un
   * gasto aparece en el rubro equivocado.
   *
   * Un préstamo sin comercio NO se mezcla con los que sí lo tienen ni se le inventa un rubro: cae
   * en su propio cajón, que es visible y se puede contar.
   */
  private keysFor(
    loan: { partnerProfileId?: string | null },
    merchants: Map<string, { businessCategory?: string | null; displayName?: string | null }>,
  ): { categoryKey: string; merchantKey: string; merchantName: string } {
    const profileId = loan.partnerProfileId ? String(loan.partnerProfileId) : null;
    const merchant = profileId ? merchants.get(profileId) : undefined;
    return {
      categoryKey: merchant ? (merchant.businessCategory ?? SIN_RUBRO) : SIN_COMERCIO,
      merchantKey: profileId ?? SIN_COMERCIO,
      merchantName: merchant?.displayName ?? 'Compra sin comercio registrado',
    };
  }

  /**
   * Los rubros ya agregados, listos para la pantalla y ordenados por lo financiado.
   *
   * Sale de `byCategory` porque es una PROYECCIÓN: no consulta nada ni decide nada, sólo redondea
   * y ordena lo que el agregado ya calculó. Dentro dejaba el método por encima de sus límites de
   * tamaño y complejidad, y mezclaba «cómo se suma» con «cómo se enseña».
   *
   * Se ordena de mayor a menor y no por nombre: un tablero cuyo orden cambia con cada pago es un
   * tablero que no se puede leer de un vistazo. El rubro principal sigue arriba aunque hoy se haya
   * pagado una cuota.
   */
  private toSortedItems(
    categories: Map<string, { label: string; totals: SpendTotals; merchants: Map<string, { name: string; totals: SpendTotals }> }>,
    overallFinanced: number,
  ) {
    return [...categories.entries()]
      .map(([key, value]) => ({
        category: key,
        financed: round(value.totals.financed),
        paid: round(value.totals.paid),
        outstanding: round(value.totals.outstanding),
        overdue: round(value.totals.overdue),
        upcoming: round(value.totals.upcoming),
        loanCount: value.totals.loanCount,
        overdueLoanCount: value.totals.overdueLoanCount,
        share: overallFinanced > 0 ? round((value.totals.financed / overallFinanced) * 100) : 0,
        merchants: [...value.merchants.entries()]
          .map(([partnerProfileId, merchant]) => ({
            partnerProfileId: partnerProfileId === SIN_COMERCIO ? null : partnerProfileId,
            displayName: merchant.name,
            financed: round(merchant.totals.financed),
            outstanding: round(merchant.totals.outstanding),
            overdue: round(merchant.totals.overdue),
            loanCount: merchant.totals.loanCount,
          }))
          .sort((left, right) => right.financed - left.financed),
      }))
      .sort((left, right) => right.financed - left.financed);
  }

  async byCategory(tenantId: string, customerId: string, now = new Date()) {
    const loans = await this.loans.findLoansByCustomer(tenantId, customerId);
    const active = loans.filter((loan) => loan.status !== 'cancelled');

    const installments = await this.loans.findInstallmentsForLoans(
      tenantId,
      active.map((loan) => String(loan.id)),
    );
    const merchants = await this.partnerProfiles.describeMany(
      tenantId,
      active
        .map((loan) => loan.partnerProfileId)
        .filter((id): id is string => Boolean(id))
        .map(String),
    );

    const scheduleByLoan = new Map<string, LoanInstallmentModel[]>();
    for (const installment of installments) {
      const key = String(installment.loanId);
      const bucket = scheduleByLoan.get(key);
      if (bucket) bucket.push(installment);
      else scheduleByLoan.set(key, [installment]);
    }

    const categories = new Map<
      string,
      { label: string; totals: SpendTotals; merchants: Map<string, { name: string; totals: SpendTotals }> }
    >();
    let overall = { ...EMPTY };
    let nextDueDate: string | null = null;

    for (const loan of active) {
      const { categoryKey, merchantKey, merchantName } = this.keysFor(loan, merchants);

      const totals = this.totalsForLoan(loan, scheduleByLoan.get(String(loan.id)) ?? [], now);

      const category = categories.get(categoryKey) ?? { label: categoryKey, totals: { ...EMPTY }, merchants: new Map() };
      category.totals = this.add(category.totals, totals);
      const merchantEntry = category.merchants.get(merchantKey) ?? { name: merchantName, totals: { ...EMPTY } };
      merchantEntry.totals = this.add(merchantEntry.totals, totals);
      category.merchants.set(merchantKey, merchantEntry);
      categories.set(categoryKey, category);

      overall = this.add(overall, totals);

      const soonest = this.nextDue(scheduleByLoan.get(String(loan.id)) ?? [], now);
      if (soonest && (nextDueDate === null || soonest < nextDueDate)) nextDueDate = soonest;
    }

    const items = this.toSortedItems(categories, overall.financed);

    return {
      customerId,
      currencyCode: active[0]?.currencyCode ?? 'BOB',
      generatedAt: now.toISOString(),
      totals: {
        financed: round(overall.financed),
        paid: round(overall.paid),
        outstanding: round(overall.outstanding),
        overdue: round(overall.overdue),
        upcoming: round(overall.upcoming),
        loanCount: overall.loanCount,
        overdueLoanCount: overall.overdueLoanCount,
      },
      nextDueDate,
      categories: items,
    };
  }

  /**
   * Lo vencido se mide con el calendario y no con `days_past_due` del préstamo.
   *
   * Ese contador lo actualiza un barrido periódico; entre barrido y barrido una cuota puede haber
   * vencido y el préstamo seguiría diciendo que está al corriente. Para una pantalla que le dice al
   * cliente «tienes pagos en mora», el retraso de un proceso nocturno no es una excusa aceptable.
   */
  private totalsForLoan(loan: LoanModel, schedule: readonly LoanInstallmentModel[], now: Date): SpendTotals {
    const today = now.toISOString().slice(0, 10);
    let overdue = 0;
    let upcoming = 0;

    for (const installment of schedule) {
      if (installment.status === 'paid' || installment.status === 'written_off') continue;
      const pending =
        toNumber(installment.principalAmount) +
        toNumber(installment.interestAmount) +
        toNumber(installment.lateFeeAmount) -
        toNumber(installment.paidPrincipal) -
        toNumber(installment.paidInterest) -
        toNumber(installment.paidLateFee);
      if (pending <= 0) continue;
      if (installment.dueDate < today) overdue += pending;
      else upcoming += pending;
    }

    return {
      financed: toNumber(loan.principalAmount),
      paid: toNumber(loan.paidPrincipal) + toNumber(loan.paidInterest) + toNumber(loan.paidLateFee),
      outstanding: toNumber(loan.outstandingPrincipal),
      overdue,
      upcoming,
      loanCount: 1,
      overdueLoanCount: overdue > 0 ? 1 : 0,
    };
  }

  private nextDue(schedule: readonly LoanInstallmentModel[], now: Date): string | null {
    const today = now.toISOString().slice(0, 10);
    const pending = schedule
      .filter((installment) => installment.status !== 'paid' && installment.status !== 'written_off' && installment.dueDate >= today)
      .map((installment) => installment.dueDate)
      .sort();
    return pending[0] ?? null;
  }

  private add(left: SpendTotals, right: SpendTotals): SpendTotals {
    return {
      financed: left.financed + right.financed,
      paid: left.paid + right.paid,
      outstanding: left.outstanding + right.outstanding,
      overdue: left.overdue + right.overdue,
      upcoming: left.upcoming + right.upcoming,
      loanCount: left.loanCount + right.loanCount,
      overdueLoanCount: left.overdueLoanCount + right.overdueLoanCount,
    };
  }
}
