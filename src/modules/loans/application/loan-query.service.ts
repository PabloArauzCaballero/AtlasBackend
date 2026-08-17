/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza sostiene el ciclo del préstamo desembolsado con saldos reconstruibles.
 * @system compone las vistas de lectura del préstamo sin exponer columnas internas de persistencia.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { LoanModel } from '../../../database/models/index.js';
import { LoansRepository } from '../loans.repository.js';

@Injectable()
export class LoanQueryService {
  constructor(private readonly loans: LoansRepository) {}

  async listByCustomer(tenantId: string, customerId: string) {
    const loans = await this.loans.findLoansByCustomer(tenantId, customerId);
    return { items: loans.map((loan) => this.summary(loan)) };
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

    return {
      ...this.summary(loan),
      schedule: installments.map((installment) => ({
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
