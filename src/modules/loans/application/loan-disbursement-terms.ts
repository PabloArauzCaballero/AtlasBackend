/**
 * @file Utilidad de aplicación: los términos del préstamo que se va a desembolsar.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system calcula importe, plazo, tasa, fechas y cronograma de datos a datos, sin base ni usuario.
 */
import { BadRequestException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { InternalRbacRepository } from '../../internal-users/internal-rbac.repository.js';
import { addMonthsClamped, buildSchedule, toDateOnly } from '../domain/loan-schedule.js';
import { fromCents, toCents } from '../domain/money.util.js';
import { resolveAnnualRate } from './loan-disbursement-rate.js';
import { DisburseLoanDto } from '../loans.schemas.js';

export { toDateOnly };

export type DisbursementTerms = {
  principalCents: number;
  termMonths: number;
  annualRate: number;
  disbursedAt: Date;
  firstDueDate: Date;
  maturityDate: string;
  scheduledInterestCents: number;
  schedule: ReturnType<typeof buildSchedule>;
};

/**
 * Todo lo que define el préstamo antes de escribirlo: importe, plazo, tasa, fechas y cronograma.
 *
 * Se extrae del método de desembolso porque es la parte que decide QUÉ se va a deber, y separarla de
 * la que lo persiste permite leerla —y discutirla— sin atravesar la transacción. También la vuelve
 * verificable: es una función de datos a datos, sin base ni usuario de por medio.
 */
export async function resolveDisbursementTerms(params: {
  application: { requestedAmount: string; requestedTermMonths: number; decisionPricedRate: string | null };
  product: {
    annualInterestRate: string | null;
    minAnnualInterestRate: string | null;
    maxAnnualInterestRate: string | null;
  };
  body: DisburseLoanDto;
  currentUser: AuthenticatedUser;
  tenantId: string;
  rbac: InternalRbacRepository;
}): Promise<DisbursementTerms> {
  const { application, product, body, currentUser, tenantId, rbac } = params;
  const principalCents = toCents(application.requestedAmount);
  const termMonths = application.requestedTermMonths;
  const annualRate = await resolveAnnualRate({ application, product, body, currentUser, tenantId, rbac });

  const disbursedAt = body.disbursedAt ? new Date(body.disbursedAt) : new Date();
  // Sin primera fecha explícita, el primer vencimiento cae un mes después del desembolso.
  const firstDueDate = body.firstDueDate ? new Date(`${body.firstDueDate}T00:00:00.000Z`) : addMonthsClamped(disbursedAt, 1);

  const schedule = buildSchedule({ principalCents, annualInterestRatePercent: annualRate, termMonths, firstDueDate });
  const lastEntry = schedule[schedule.length - 1];
  if (!lastEntry) throw new BadRequestException('EMPTY_LOAN_SCHEDULE');

  return {
    principalCents,
    termMonths,
    annualRate,
    disbursedAt,
    firstDueDate,
    maturityDate: lastEntry.dueDate,
    scheduledInterestCents: schedule.reduce((total, entry) => total + entry.interestCents, 0),
    schedule,
  };
}

/** Las columnas de dinero del préstamo. Se escriben juntas o el saldo inicial no cuadra. */
export function loanAmountColumns(terms: DisbursementTerms) {
  return {
    principalAmount: fromCents(terms.principalCents),
    annualInterestRate: terms.annualRate.toFixed(4),
    termMonths: terms.termMonths,
    scheduledPrincipal: fromCents(terms.principalCents),
    scheduledInterest: fromCents(terms.scheduledInterestCents),
    outstandingPrincipal: fromCents(terms.principalCents),
  };
}

export function installmentRows(tenantId: string, loanId: string, schedule: DisbursementTerms['schedule']) {
  return schedule.map((entry) => ({
    tenantId,
    loanId,
    installmentNumber: entry.installmentNumber,
    dueDate: entry.dueDate,
    principalAmount: fromCents(entry.principalCents),
    interestAmount: fromCents(entry.interestCents),
    status: 'pending',
    // Mismo motivo que en el préstamo: el modelo exige estas columnas y la base sólo las
    // rellenaría si Sequelize llegara a preguntarle.
    lateFeeAmount: '0.00',
    paidPrincipal: '0.00',
    paidInterest: '0.00',
    paidLateFee: '0.00',
    daysPastDue: 0,
    createdAtValue: new Date(),
    deleted: false,
  }));
}
