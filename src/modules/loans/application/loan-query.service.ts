/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system compone las vistas de lectura del préstamo sin exponer columnas internas de persistencia.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { LoanModel } from '../../../database/models/index.js';
import { PartnerProfileService } from '../../partner-onboarding/application/partner-profile.service.js';
import { LoansRepository } from '../loans.repository.js';

type MerchantView = { partnerProfileId: string; displayName: string; businessCategory: string | null } | null;

@Injectable()
export class LoanQueryService {
  constructor(
    private readonly loans: LoansRepository,
    private readonly partnerProfiles: PartnerProfileService,
  ) {}

  /**
   * Los créditos del cliente, cada uno con el comercio donde nació.
   *
   * Los comercios se resuelven de una vez y no por préstamo: la pantalla de pagos los agrupa por
   * comercio, así que preguntarlos uno a uno haría tantas consultas como compras tenga el cliente.
   */
  async listByCustomer(tenantId: string, customerId: string) {
    const loans = await this.loans.findLoansByCustomer(tenantId, customerId);
    const merchants = await this.merchantsFor(tenantId, loans);
    return { items: loans.map((loan) => ({ ...this.summary(loan), merchant: this.merchantOf(loan, merchants) })) };
  }

  private merchantsFor(tenantId: string, loans: readonly LoanModel[]) {
    const ids = loans.map((loan) => loan.partnerProfileId).filter((id): id is string => Boolean(id));
    return this.partnerProfiles.describeMany(tenantId, ids.map(String));
  }

  /**
   * Un crédito sin comercio conocido devuelve `null` y no un comercio inventado.
   *
   * Los créditos anteriores al vínculo no saben dónde se compraron, y rellenarlos con «Otros» los
   * mezclaría con los que de verdad no tienen rubro. La pantalla decide cómo mostrar la ausencia;
   * el servidor no la disfraza.
   */
  private merchantOf(loan: LoanModel, merchants: Map<string, { displayName: string; businessCategory: string | null }>): MerchantView {
    if (!loan.partnerProfileId) return null;
    const found = merchants.get(String(loan.partnerProfileId));
    if (!found) return null;
    return { partnerProfileId: String(loan.partnerProfileId), ...found };
  }

  /**
   * Ficha del préstamo: cabecera, cronograma, cobros e historial.
   *
   * Se devuelve entera y no por partes porque quien la abre —cobranza, atención, auditoría— quiere
   * responder «¿por qué debe esto?», y esa respuesta es exactamente la relación entre las cuatro
   * cosas. Pedirlas en cuatro viajes deja al cliente componiendo un estado que puede cambiar entre
   * llamada y llamada.
   */
  async detail(tenantId: string, loanId: string) {
    const loan = await this.loans.findLoanById(tenantId, loanId);
    if (!loan) throw new NotFoundException('LOAN_NOT_FOUND');

    const [installments, payments, events] = await Promise.all([
      this.loans.findInstallments(tenantId, loanId),
      this.loans.findPaymentsByLoan(tenantId, loanId),
      this.loans.findEventsByLoan(tenantId, loanId),
    ]);

    const merchants = await this.merchantsFor(tenantId, [loan]);

    return {
      ...this.summary(loan),
      merchant: this.merchantOf(loan, merchants),
      schedule: installments.map((installment) => ({
        /*
         * El identificador de la cuota, que ANTES no salía.
         *
         * Sin él la app podía enseñar el calendario pero no pagar ninguna cuota: avisar de un pago
         * exige decir de QUÉ cuota se habla, y el número de orden no sirve —se repite entre
         * créditos—. La pantalla de pago quedaba sin forma de nombrar lo que el cliente acababa de
         * transferir.
         */
        installmentId: String(installment.id),
        installmentNumber: installment.installmentNumber,
        dueDate: installment.dueDate,
        principalAmount: installment.principalAmount,
        interestAmount: installment.interestAmount,
        lateFeeAmount: installment.lateFeeAmount,
        paidPrincipal: installment.paidPrincipal,
        paidInterest: installment.paidInterest,
        paidLateFee: installment.paidLateFee,
        status: installment.status,
        daysPastDue: installment.daysPastDue,
        settledAt: installment.settledAt,
      })),
      payments: payments.map((payment) => ({
        paymentId: payment.id,
        paymentCode: payment.paymentCode,
        amount: payment.amount,
        currencyCode: payment.currencyCode,
        paymentMethod: payment.paymentMethod,
        externalReference: payment.externalReference,
        receivedAt: payment.receivedAt,
        status: payment.status,
        reversedAt: payment.reversedAt,
        reversalReasonCode: payment.reversalReasonCode,
      })),
      history: events.map((event) => ({
        eventType: event.eventType,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
        reasonCode: event.reasonCode,
        happenedAt: event.happenedAt,
        notes: event.notes,
      })),
    };
  }

  /**
   * La cabecera incluye la referencia a la decisión que originó el préstamo.
   *
   * No es metadato decorativo: es lo que permite ir del dinero prestado a la versión del artefacto
   * que lo autorizó, y al revés. Ocultarla dejaría al equipo de riesgo sin poder auditar su propia
   * política sobre casos concretos.
   */
  private summary(loan: LoanModel) {
    return {
      loanId: loan.id,
      loanCode: loan.loanCode,
      customerId: loan.customerId,
      creditApplicationId: loan.creditApplicationId,
      currencyCode: loan.currencyCode,
      principalAmount: loan.principalAmount,
      annualInterestRate: loan.annualInterestRate,
      termMonths: loan.termMonths,
      status: loan.status,
      disbursedAt: loan.disbursedAt,
      firstDueDate: loan.firstDueDate,
      maturityDate: loan.maturityDate,
      paidPrincipal: loan.paidPrincipal,
      paidInterest: loan.paidInterest,
      paidLateFee: loan.paidLateFee,
      outstandingPrincipal: loan.outstandingPrincipal,
      daysPastDue: loan.daysPastDue,
      worstDaysPastDue: loan.worstDaysPastDue,
      delinquencyBucket: loan.delinquencyBucket,
      writtenOffAt: loan.writtenOffAt,
      writtenOffAmount: loan.writtenOffAmount,
      decision: {
        executionId: loan.decisionExecutionId,
        artifactVersionId: loan.decisionArtifactVersionId,
      },
    };
  }
}
