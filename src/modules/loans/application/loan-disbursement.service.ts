/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system convierte una solicitud aprobada en un préstamo con cronograma, dentro de una sola transacción.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import type { LoanModel } from '../../../database/models/index.js';
import { createStableCode, sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { env } from '../../../config/env.js';
import { CreditRepository } from '../../credit/credit.repository.js';
import { decisionExpiresAt, ExposureReservationService } from '../../credit/application/exposure-reservation.service.js';
import { OriginationConsentCheck } from '../../credit/application/origination-consent-check.service.js';
import { InternalRbacRepository } from '../../internal-users/internal-rbac.repository.js';
import { fromCents } from '../domain/money.util.js';
import { installmentRows, loanAmountColumns, resolveDisbursementTerms, toDateOnly } from './loan-disbursement-terms.js';
import { DisburseLoanDto } from '../loans.schemas.js';
import { LoansRepository } from '../loans.repository.js';

/** Sólo una solicitud aprobada origina un préstamo. Ni una en revisión, ni una ya desembolsada. */
const DISBURSABLE_APPLICATION_STATUS = 'approved';

/**
 * La segunda pregunta tiene que estar contestada antes de que haya dinero.
 *
 * El Motor responde «¿cumple el riesgo?» y deja `businessAcceptance = 'pending'`; el negocio
 * responde «¿queremos esta operación?». Hasta el 2026-09-14 el desembolso sólo miraba
 * `status = 'approved'`, así que una aprobación del Motor todavía sin aceptar se podía desembolsar
 * igual — la segunda pregunta existía y no ataba nada. `null` sigue siendo desembolsable: es una
 * aprobación firmada por una persona, que ya lleva dentro la voluntad del negocio.
 */
const BUSINESS_ACCEPTANCE_BLOCKERS: Readonly<Record<string, string>> = {
  pending: 'CREDIT_BUSINESS_ACCEPTANCE_PENDING',
  declined: 'CREDIT_BUSINESS_ACCEPTANCE_DECLINED',
};

@Injectable()
export class LoanDisbursementService {
  constructor(
    private readonly loans: LoansRepository,
    private readonly credit: CreditRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly exposure: ExposureReservationService,
    private readonly consents: OriginationConsentCheck,
    private readonly rbac: InternalRbacRepository,
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

    const resultado = await this.sequelize.transaction(async (transaction) => {
      const application = await this.credit.findApplicationById(input.tenantId, input.applicationId, { transaction });
      if (!application) throw new NotFoundException('CREDIT_APPLICATION_NOT_FOUND');
      assertDisbursable(application);

      const existing = await this.loans.findLoanByApplication(input.tenantId, input.applicationId, { transaction });
      // Reintento del mismo desembolso: se devuelve el préstamo que ya existe en vez de crear otro.
      if (existing) return this.retryOf(existing, idempotencyKeyHash);

      const product = await this.credit.findProductById(input.tenantId, application.creditProductId, { transaction });
      if (!product) throw new NotFoundException('CREDIT_PRODUCT_NOT_FOUND');

      const { body, currentUser, tenantId } = input;
      const terms = await resolveDisbursementTerms({ application, product, body, currentUser, tenantId, rbac: this.rbac });
      const now = new Date();
      await this.revalidateAndReserve(input.tenantId, application, now, transaction);

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
      // El cupo reservado pasa a ser préstamo en la misma transacción: si algo falla, ni préstamo ni consumo.
      await this.exposure.consume(
        { tenantId: input.tenantId, applicationId: String(application.id), loanId: String(loan.id), now },
        transaction,
      );

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
            // Frente 3A: si un operador anuló la tasa decidida, el motivo queda en el historial —
            // el permiso autoriza a PEDIR la excepción, esto es la evidencia de que se pidió.
            rateOverrideReasonCode: input.body.overrideReasonCode ?? null,
          },
          happenedAt: terms.disbursedAt,
          // `_created_at` es obligatorio en el modelo y no lo pone la base porque Sequelize valida
          // antes: mismo motivo que en el préstamo y en las cuotas.
          createdAtValue: terms.disbursedAt,
        },
        { transaction },
      );

      return { descripcion: this.describe(loan), loan, disbursedAt: terms.disbursedAt };
    });

    /*
     * El alta del crédito en el motor NO se hace aquí, y no es por comodidad: el libro de préstamos
     * no tiene permitido depender del módulo de integración con el motor (`config/architecture/
     * boundaries.json`: `loans` sólo puede apoyarse en `credit`), y meter esa llamada aquí era
     * invertir la dirección del acoplamiento — el libro pasaría a necesitar al motor para poder
     * desembolsar.
     *
     * Lo hace `OutcomeDispatchService.registrarCreditosNuevos`, del lado del motor, que es quien
     * conoce ese contrato. Se pierde inmediatez y no se pierde exactitud: el motor fecha las
     * ventanas de observación desde la DECISIÓN, no desde el alta, así que registrar un rato después
     * no corre ninguna ventana. Lo que queda escrito aquí es el rastro que lo hace posible
     * —`decisionExecutionId`—, sin el cual el crédito no se podría atribuir a nadie.
     */
    return resultado.descripcion;
  }

  /**
   * La concesión REVALIDA la decisión en el momento de entregar el dinero (P-09, P-10, P-11).
   *
   * Tres cosas que pudieron cambiar desde que el motor aprobó, en el orden en que fallan:
   *
   * 1. Que la decisión siga vigente (`CREDIT_DECISION_VALIDITY_HOURS`): una aprobación de hace semanas
   *    se tomó con otra deuda y otra línea.
   * 2. Que el cliente no haya retirado un consentimiento del que dependía (lo mide el core, donde vive
   *    el consentimiento, aunque el motor no se haya enterado todavía).
   * 3. Que el importe quepa en el cupo de su línea, bajo el cerrojo del cliente: de dos desembolsos
   *    concurrentes que juntos lo exceden, sólo uno reserva.
   */
  private async revalidateAndReserve(
    tenantId: string,
    application: {
      id: string;
      customerId: string;
      requestedAmount: string;
      currencyCode: string;
      decidedAt: Date | null;
      decisionValidUntil?: Date | null;
    },
    now: Date,
    transaction: Transaction,
  ): Promise<void> {
    const expiresAt = decisionExpiresAt(application.decidedAt, env.CREDIT_DECISION_VALIDITY_HOURS, application.decisionValidUntil);
    if (expiresAt.getTime() <= now.getTime()) throw new ConflictException('CREDIT_DECISION_EXPIRED');
    await this.consents.assertMayOriginate(
      { tenantId, customerId: String(application.customerId), decidedAt: application.decidedAt },
      transaction,
    );
    await this.exposure.reserve(
      {
        tenantId,
        customerId: String(application.customerId),
        applicationId: String(application.id),
        amount: application.requestedAmount,
        currencyCode: application.currencyCode,
        expiresAt,
        now,
      },
      transaction,
    );
  }

  /**
   * El reintento del mismo desembolso devuelve el préstamo que ya existe, y de paso vuelve a
   * intentar su alta en el motor: si la primera vez el motor no estaba, este camino es la segunda
   * oportunidad, y el alta es idempotente allí. Con OTRA clave, es un segundo desembolso: conflicto.
   */
  private retryOf(existing: LoanModel, idempotencyKeyHash: string) {
    if (existing.idempotencyKeyHash !== idempotencyKeyHash) throw new ConflictException('LOAN_ALREADY_DISBURSED');
    return { descripcion: this.describe(existing), loan: existing, disbursedAt: existing.disbursedAt };
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

/** Sólo una solicitud aprobada Y con la segunda pregunta contestada origina un préstamo. */
function assertDisbursable(application: { status: string; businessAcceptance: string | null }): void {
  if (application.status !== DISBURSABLE_APPLICATION_STATUS) throw new ConflictException('CREDIT_APPLICATION_NOT_APPROVED');
  const acceptanceBlocker = BUSINESS_ACCEPTANCE_BLOCKERS[application.businessAcceptance ?? ''];
  if (acceptanceBlocker) throw new ConflictException(acceptanceBlocker);
}
