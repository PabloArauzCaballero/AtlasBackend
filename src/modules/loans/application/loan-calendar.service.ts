/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza le dice al cliente qué día le toca cada pago y cuáles ya se le pasaron.
 * @system aplana el cronograma de todos los préstamos del cliente en una sola línea de tiempo.
 */
import { Injectable } from '@nestjs/common';
import { LoanInstallmentModel, LoanModel } from '../../../database/models/index.js';
import { PartnerProfileService } from '../../partner-onboarding/application/partner-profile.service.js';
import { LoansRepository } from '../loans.repository.js';

/**
 * El estado de una cuota, decidido por el SERVIDOR.
 *
 * Es el mismo vocabulario que ya usa el reparto por rubro —vencido, por vencer, pagado—, y se
 * resuelve aquí por la misma razón: si cada pantalla lo dedujera por su cuenta, dos vistas de la
 * misma app podrían pintar la misma cuota de dos colores. El color de una cuota es la respuesta a
 * «¿voy bien?», y esa respuesta no puede depender de qué pantalla la mire.
 */
export type InstallmentState = 'overdue' | 'upcoming' | 'paid' | 'written_off';

const SIN_COMERCIO = 'sin_comercio';

function toNumber(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * El calendario de pagos del cliente.
 *
 * ## Por qué es un endpoint y no tres llamadas a la ficha del préstamo
 *
 * Un calendario mezcla las cuotas de TODOS los préstamos: es una línea de tiempo, no una ficha.
 * Componerlo en el teléfono obligaría a pedir la ficha completa de cada crédito —con sus cobros y su
 * historial— para quedarse con una fecha y un importe de cada una, y a repetir esa ráfaga cada vez
 * que se cambia de mes.
 *
 * ## Por qué el estado viaja resuelto
 *
 * Porque «rojo, ámbar o verde» ES la información. Mandar fechas crudas y dejar que el dispositivo
 * compare contra su propio reloj hace que un teléfono con la fecha corrida enseñe una mora que no
 * existe —o esconda una que sí—. La comparación se hace una vez, aquí, contra el reloj del servidor.
 *
 * Lo vencido se mide contra el CALENDARIO y no contra `days_past_due` del préstamo: ese contador lo
 * actualiza un barrido periódico y puede ir por detrás.
 */
@Injectable()
export class LoanCalendarService {
  constructor(
    private readonly loans: LoansRepository,
    private readonly partnerProfiles: PartnerProfileService,
  ) {}

  async forCustomer(tenantId: string, customerId: string, now = new Date()) {
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

    const loanById = new Map(active.map((loan) => [String(loan.id), loan]));
    const today = now.toISOString().slice(0, 10);

    const entries = installments
      .filter((installment) => loanById.has(String(installment.loanId)))
      .map((installment) => this.toEntry(installment, loanById.get(String(installment.loanId))!, merchants, today))
      /*
       * Por fecha y, dentro del mismo día, por comercio y número de cuota. Dos cuotas que caen el
       * mismo día tienen que salir siempre en el mismo orden: una lista que se reordena sola entre
       * recargas obliga a releerla entera para encontrar la de siempre.
       */
      .sort((left, right) => {
        if (left.dueDate !== right.dueDate) return left.dueDate < right.dueDate ? -1 : 1;
        if (left.merchant.displayName !== right.merchant.displayName) {
          return left.merchant.displayName < right.merchant.displayName ? -1 : 1;
        }
        return left.installmentNumber - right.installmentNumber;
      });

    const totals = entries.reduce(
      (accumulator, entry) => ({
        overdue: accumulator.overdue + (entry.state === 'overdue' ? entry.pendingAmount : 0),
        upcoming: accumulator.upcoming + (entry.state === 'upcoming' ? entry.pendingAmount : 0),
        paid: accumulator.paid + (entry.state === 'paid' ? entry.paidAmount : 0),
        overdueCount: accumulator.overdueCount + (entry.state === 'overdue' ? 1 : 0),
        upcomingCount: accumulator.upcomingCount + (entry.state === 'upcoming' ? 1 : 0),
        paidCount: accumulator.paidCount + (entry.state === 'paid' ? 1 : 0),
      }),
      { overdue: 0, upcoming: 0, paid: 0, overdueCount: 0, upcomingCount: 0, paidCount: 0 },
    );

    const nextDueDate = entries.find((entry) => entry.state === 'upcoming')?.dueDate ?? null;

    return {
      customerId,
      currencyCode: active[0]?.currencyCode ?? 'BOB',
      generatedAt: now.toISOString(),
      today,
      nextDueDate,
      totals: {
        overdue: round(totals.overdue),
        upcoming: round(totals.upcoming),
        paid: round(totals.paid),
        overdueCount: totals.overdueCount,
        upcomingCount: totals.upcomingCount,
        paidCount: totals.paidCount,
      },
      entries,
    };
  }

  /**
   * Una cuota, con todo lo que hace falta para pintarla y para abrirla.
   *
   * Lleva el préstamo y el comercio dentro porque la pantalla del calendario NO tiene la lista de
   * créditos a mano: una cuota suelta en un día del mes tiene que poder decir de quién es sin que la
   * app cruce nada.
   */
  private toEntry(
    installment: LoanInstallmentModel,
    loan: LoanModel,
    merchants: Map<string, { displayName: string; businessCategory: string | null }>,
    today: string,
  ) {
    const owed =
      toNumber(installment.principalAmount) + toNumber(installment.interestAmount) + toNumber(installment.lateFeeAmount);
    const paid = toNumber(installment.paidPrincipal) + toNumber(installment.paidInterest) + toNumber(installment.paidLateFee);
    const pending = Math.max(0, owed - paid);

    const profileId = loan.partnerProfileId ? String(loan.partnerProfileId) : null;
    const merchant = profileId ? merchants.get(profileId) : undefined;
    const state = this.stateOf(installment, pending, today);

    return {
      loanId: String(loan.id),
      loanCode: loan.loanCode,
      installmentNumber: installment.installmentNumber,
      dueDate: installment.dueDate,
      state,
      /** Días de atraso medidos contra el calendario; 0 en lo que aún no vence y en lo ya pagado. */
      daysPastDue: this.daysLate(installment.dueDate, today, state),
      totalAmount: round(owed),
      paidAmount: round(paid),
      pendingAmount: round(pending),
      principalAmount: round(toNumber(installment.principalAmount)),
      interestAmount: round(toNumber(installment.interestAmount)),
      lateFeeAmount: round(toNumber(installment.lateFeeAmount)),
      currencyCode: loan.currencyCode,
      merchant: {
        partnerProfileId: profileId && merchant ? profileId : null,
        displayName: merchant?.displayName ?? 'Compra sin comercio registrado',
        businessCategory: merchant?.businessCategory ?? (merchant ? null : SIN_COMERCIO),
      },
    };
  }

  /**
   * Una cuota castigada NO es una cuota pagada.
   *
   * Se distingue con su propio estado en vez de colarla entre las verdes: al cliente se le está
   * diciendo que ya no se le va a cobrar, no que él pagó. Confundirlas escribiría en su pantalla una
   * historia de pagos que no ocurrió.
   */
  private stateOf(installment: LoanInstallmentModel, pending: number, today: string): InstallmentState {
    if (installment.status === 'written_off') return 'written_off';
    if (installment.status === 'paid' || pending <= 0) return 'paid';
    return installment.dueDate < today ? 'overdue' : 'upcoming';
  }

  private daysLate(dueDate: string, today: string, state: InstallmentState): number {
    if (state !== 'overdue') return 0;
    return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000));
  }
}
