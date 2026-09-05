/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system convierte una solicitud aprobada en un préstamo con cronograma, dentro de una sola transacción.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { createStableCode, sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CreditRepository } from '../../credit/credit.repository.js';
import { addMonthsClamped, buildSchedule, toDateOnly } from '../domain/loan-schedule.js';
import { fromCents, toCents } from '../domain/money.util.js';
import { DisburseLoanDto } from '../loans.schemas.js';
import { LoansRepository } from '../loans.repository.js';

/** Sólo una solicitud aprobada origina un préstamo. Ni una en revisión, ni una ya desembolsada. */
const DISBURSABLE_APPLICATION_STATUS = 'approved';

@Injectable()
export class LoanDisbursementService {
  constructor(
    private readonly loans: LoansRepository,
    private readonly credit: CreditRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Desembolso: el momento en que la decisión se convierte en dinero y en obligación.
   *
   * Todo ocurre en UNA transacción —préstamo, cronograma y evento— porque un préstamo sin cuotas no
   * es un estado intermedio aceptable: nadie sabría qué cobrarle ni cuándo, y la mora se calcularía
   * sobre un cronograma vacío, es decir, cero para siempre.
   *
   * La solicitud recuerda qué ejecución del motor la decidió; el préstamo hereda esa referencia. Es
   * lo que permite, meses después, atribuir el desenlace real a la versión del artefacto que lo
   * decidió — sin esa arista el monitoreo del motor no tiene a quién mirar.
   */
  async disburse(input: {
    tenantId: string;
    applicationId: string;
    body: DisburseLoanDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    const idempotencyKeyHash = sha256Hex(input.idempotencyKey);

    return this.sequelize.transaction(async (transaction) => {
      const application = await this.credit.findApplicationById(input.tenantId, input.applicationId, { transaction });
      if (!application) throw new NotFoundException('CREDIT_APPLICATION_NOT_FOUND');
      if (application.status !== DISBURSABLE_APPLICATION_STATUS) {
        throw new ConflictException('CREDIT_APPLICATION_NOT_APPROVED');
      }

      const existing = await this.loans.findLoanByApplication(input.tenantId, input.applicationId, { transaction });
      // Reintento del mismo desembolso: se devuelve el préstamo que ya existe en vez de crear otro.
      if (existing) {
        if (existing.idempotencyKeyHash === idempotencyKeyHash) return this.describe(existing);
        throw new ConflictException('LOAN_ALREADY_DISBURSED');
      }

      const product = await this.credit.findProductById(input.tenantId, application.creditProductId, { transaction });
      if (!product) throw new NotFoundException('CREDIT_PRODUCT_NOT_FOUND');

      const terms = resolveDisbursementTerms(application, product, input.body);

      const loan = await this.loans.createLoan(
        {
          tenantId: input.tenantId,
          loanCode: createStableCode('LOAN'),
          customerId: application.customerId,
          creditApplicationId: application.id,
          creditProductId: application.creditProductId,
          /*
           * El comercio se copia desde la solicitud en el desembolso, no se consulta después. En
           * este punto el crédito ya no puede cambiar de origen, y el libro de préstamos se lee
           * entero por sí mismo —igual que hace con el producto y con la traza al motor—, así que
           * el gasto por categoría no necesita volver a la solicitud para saber dónde se compró.
           */
          partnerProfileId: application.partnerProfileId ?? null,
          currencyCode: application.currencyCode,
          ...loanAmountColumns(terms),
          status: 'active',
          disbursedAt: terms.disbursedAt,
          firstDueDate: toDateOnly(terms.firstDueDate),
          maturityDate: terms.maturityDate,
          decisionExecutionId: application.decisionExecutionId ?? null,
          decisionArtifactVersionId: application.decisionArtifactVersionId ?? null,
          decisionSubjectReference: application.decisionSubjectReference ?? null,
          disbursedByInternalUserId: input.currentUser.internalUserId ?? null,
          idempotencyKeyHash,
          /*
           * El estado inicial del libro, escrito y no dejado al azar.
           *
           * Estas columnas tienen DEFAULT en PostgreSQL, pero el modelo las declara `allowNull:
           * false` sin `defaultValue`, así que Sequelize valida ANTES de llegar a la base y la
           * creación fallaba con una `ValidationError` que el filtro traducía a un 409 genérico —«la
           * operación viola una restricción de datos»— sin decir qué columna. El desembolso no había
           * funcionado nunca: `credit.loans` estaba vacía.
           *
           * Se escriben aquí en vez de añadir `defaultValue` al modelo porque son el estado de un
           * préstamo RECIÉN NACIDO —nada pagado, sin días de atraso, al corriente— y decirlo en el
           * sitio donde nace deja el hecho a la vista de quien lea el desembolso.
           */
          paidPrincipal: '0.00',
          paidInterest: '0.00',
          paidLateFee: '0.00',
          daysPastDue: 0,
          worstDaysPastDue: 0,
          delinquencyBucket: 'current',
          createdAtValue: terms.disbursedAt,
          deleted: false,
        },
        { transaction },
      );

      await this.loans.bulkCreateInstallments(installmentRows(input.tenantId, loan.id, terms.schedule), { transaction });

      await this.loans.createEvent(
        {
          tenantId: input.tenantId,
          loanId: loan.id,
          eventType: 'loan_disbursed',
          previousStatus: null,
          newStatus: 'active',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          payloadJson: {
            principal: fromCents(terms.principalCents),
            termMonths: terms.termMonths,
            annualInterestRate: terms.annualRate,
            decisionExecutionId: application.decisionExecutionId ?? null,
          },
          happenedAt: terms.disbursedAt,
          // `_created_at` es obligatorio en el modelo y no lo pone la base porque Sequelize valida
          // antes: mismo motivo que en el préstamo y en las cuotas.
          createdAtValue: terms.disbursedAt,
        },
        { transaction },
      );

      return this.describe(loan);
    });
  }

  private describe(loan: { id: string; loanCode: string; status: string; maturityDate: string | null }) {
    return {
      loanId: loan.id,
      loanCode: loan.loanCode,
      status: loan.status,
      maturityDate: loan.maturityDate,
    };
  }
}

type DisbursementTerms = {
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
function resolveDisbursementTerms(
  application: { requestedAmount: string; requestedTermMonths: number },
  product: { annualInterestRate: string | null },
  body: DisburseLoanDto,
): DisbursementTerms {
  const principalCents = toCents(application.requestedAmount);
  const termMonths = application.requestedTermMonths;
  const annualRate = Number(body.annualInterestRate ?? product.annualInterestRate ?? 0);
  if (!Number.isFinite(annualRate) || annualRate < 0) throw new BadRequestException('INVALID_INTEREST_RATE');

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
function loanAmountColumns(terms: DisbursementTerms) {
  return {
    principalAmount: fromCents(terms.principalCents),
    annualInterestRate: terms.annualRate.toFixed(4),
    termMonths: terms.termMonths,
    scheduledPrincipal: fromCents(terms.principalCents),
    scheduledInterest: fromCents(terms.scheduledInterestCents),
    outstandingPrincipal: fromCents(terms.principalCents),
  };
}

function installmentRows(tenantId: string, loanId: string, schedule: DisbursementTerms['schedule']) {
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
