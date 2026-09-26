import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { LoanPaymentService } from '../../../src/modules/loans/application/loan-payment.service.js';

/**
 * Aplicar y deshacer cobros sobre el cronograma.
 *
 * Es el sitio del backend donde un error se mide en dinero: un céntimo mal repartido no se nota en
 * una prueba manual y descuadra el libro al cierre. Lo que fijan estas pruebas es la aritmética y
 * las tres decisiones que la sostienen — no aplicar dos veces el mismo cobro, no aceptar de más, y
 * recalcular el total del préstamo desde sus cuotas en vez de llevar un contador.
 */
describe('LoanPaymentService', () => {
  function installment(overrides: Record<string, unknown> = {}) {
    return {
      id: 'i1',
      installmentNumber: 1,
      dueDate: '2026-01-31',
      principalAmount: '100.00',
      interestAmount: '10.00',
      lateFeeAmount: '0.00',
      paidPrincipal: '0.00',
      paidInterest: '0.00',
      paidLateFee: '0.00',
      status: 'pending',
      settledAt: null,
      updatedAtValue: null,
      save: jest.fn(async () => undefined),
      ...overrides,
    };
  }

  function build(options: { loan?: Record<string, unknown>; installments?: ReturnType<typeof installment>[] } = {}) {
    const loan = {
      id: 'loan-1',
      tenantId: 't1',
      status: 'active',
      currencyCode: 'BOB',
      paidPrincipal: '0.00',
      paidInterest: '0.00',
      paidLateFee: '0.00',
      outstandingPrincipal: '100.00',
      closedAt: null,
      daysPastDue: 30,
      delinquencyBucket: 'late_30',
      updatedAtValue: null,
      save: jest.fn(async () => undefined),
      ...options.loan,
    };
    const installments = options.installments ?? [installment()];
    const loans = {
      findPaymentByIdempotency: jest.fn(async (..._args: unknown[]) => null),
      findLoanForUpdate: jest.fn(async (..._args: unknown[]) => loan),
      findCollectableInstallments: jest.fn(async (..._args: unknown[]) => installments),
      findInstallments: jest.fn(async (..._args: unknown[]) => installments),
      createPayment: jest.fn(async (values: Record<string, unknown>) => ({ id: 'pay-1', ...values })),
      bulkCreateAllocations: jest.fn(async (..._args: unknown[]) => undefined),
      createEvent: jest.fn(async (..._args: unknown[]) => undefined),
      findPaymentForUpdate: jest.fn(async (..._args: unknown[]) => null),
      findAllocationsByPayment: jest.fn(async (..._args: unknown[]) => []),
    };
    const sequelize = { transaction: jest.fn(async (callback: (t: unknown) => Promise<unknown>) => callback({})) };
    const service = new LoanPaymentService(loans as never, sequelize as never);
    return { service, loans, loan, installments };
  }

  const currentUser = { role: 'internal_user', internalUserId: 'u1', customerId: null, platformUserId: null } as never;

  const paymentInput = (overrides: Record<string, unknown> = {}) => ({
    tenantId: 't1',
    loanId: 'loan-1',
    body: { amount: '110.00', currencyCode: 'BOB', paymentMethod: 'transfer', ...overrides },
    currentUser,
    idempotencyKey: 'idem-1',
  });

  describe('registerPayment', () => {
    /** La pasarela reintenta; el cobro no puede aplicarse dos veces por eso. */
    it('devuelve el cobro ya registrado sin volver a aplicarlo', async () => {
      const { service, loans } = build();
      (loans.findPaymentByIdempotency as jest.Mock).mockResolvedValueOnce({ id: 'pay-0', paymentCode: 'PAY-0' } as never);

      await expect(service.registerPayment(paymentInput() as never)).resolves.toEqual({
        paymentId: 'pay-0',
        paymentCode: 'PAY-0',
        duplicated: true,
      });
      expect(loans.createPayment).not.toHaveBeenCalled();
      expect(loans.findLoanForUpdate).not.toHaveBeenCalled();
    });

    it('exige que el préstamo exista, esté vivo y sea de la misma moneda', async () => {
      const sinPrestamo = build();
      (sinPrestamo.loans.findLoanForUpdate as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(sinPrestamo.service.registerPayment(paymentInput() as never)).rejects.toThrow(NotFoundException);

      const cerrado = build({ loan: { status: 'paid_off' } });
      await expect(cerrado.service.registerPayment(paymentInput() as never)).rejects.toThrow(/LOAN_NOT_COLLECTABLE/);

      const otraMoneda = build();
      await expect(otraMoneda.service.registerPayment(paymentInput({ currencyCode: 'USD' }) as never)).rejects.toThrow(/CURRENCY_MISMATCH/);
    });

    /**
     * El excedente es una decisión de producto —¿prepago, saldo a favor, devolución?— y adivinarla
     * dentro de un repartidor de céntimos sería inventar política de negocio.
     */
    it('rechaza un cobro mayor que lo pendiente en vez de aplicarlo a medias', async () => {
      const { service, loans } = build();
      await expect(service.registerPayment(paymentInput({ amount: '200.00' }) as never)).rejects.toThrow(UnprocessableEntityException);
      expect(loans.createPayment).not.toHaveBeenCalled();
    });

    it('reparte el cobro, marca la cuota saldada y anota el movimiento', async () => {
      const { service, loans, installments } = build();

      const result = await service.registerPayment(paymentInput() as never);

      expect(loans.bulkCreateAllocations).toHaveBeenCalledTimes(1);
      const [allocations] = (loans.bulkCreateAllocations as jest.Mock).mock.calls[0] as [Record<string, string>[]];
      expect(allocations).toEqual([
        expect.objectContaining({ principalApplied: '100.00', interestApplied: '10.00', lateFeeApplied: '0.00' }),
      ]);
      expect(installments[0].status).toBe('paid');
      expect(installments[0].settledAt).toBeInstanceOf(Date);
      expect(result).toMatchObject({ paymentId: 'pay-1', duplicated: false });
      expect((loans.createEvent as jest.Mock).mock.calls[0][0]).toMatchObject({ eventType: 'payment_applied' });
    });

    it('un cobro parcial deja la cuota como parcialmente pagada, sin fecha de liquidación', async () => {
      const { service, installments } = build();

      await service.registerPayment(paymentInput({ amount: '30.00' }) as never);

      expect(installments[0].status).toBe('partially_paid');
      expect(installments[0].settledAt).toBeNull();
      expect(installments[0].paidPrincipal).toBe('20.00');
      expect(installments[0].paidInterest).toBe('10.00');
    });

    /** El cronograma es la verdad; el total del préstamo es su suma, no un contador incrementado. */
    it('recalcula los acumulados del préstamo desde sus cuotas y lo cancela cuando no queda nada', async () => {
      const { service, loan } = build();

      await service.registerPayment(paymentInput() as never);

      expect(loan.paidPrincipal).toBe('100.00');
      expect(loan.paidInterest).toBe('10.00');
      expect(loan.outstandingPrincipal).toBe('0.00');
      expect(loan.status).toBe('paid_off');
      expect(loan.closedAt).toBeInstanceOf(Date);
      expect(loan.daysPastDue).toBe(0);
      expect(loan.delinquencyBucket).toBe('current');
    });

    it('con más de una cuota, aplica primero la más antigua', async () => {
      const primera = installment({ id: 'i1', installmentNumber: 1, dueDate: '2026-01-31' });
      const segunda = installment({ id: 'i2', installmentNumber: 2, dueDate: '2026-02-28' });
      const { service, loans } = build({ installments: [segunda, primera] });

      await service.registerPayment(paymentInput({ amount: '110.00' }) as never);

      const [allocations] = (loans.bulkCreateAllocations as jest.Mock).mock.calls[0] as [Record<string, string>[]];
      expect(allocations).toHaveLength(1);
      expect(allocations[0]).toMatchObject({ loanInstallmentId: 'i1' });
    });
  });

  describe('reversePayment', () => {
    const reverseInput = {
      tenantId: 't1',
      loanId: 'loan-1',
      paymentId: 'pay-1',
      body: { reasonCode: 'chargeback' },
      currentUser,
    };

    it('exige que el cobro exista, sea de ese préstamo y no esté ya reversado', async () => {
      const inexistente = build();
      await expect(inexistente.service.reversePayment(reverseInput as never)).rejects.toThrow(NotFoundException);

      const deOtroPrestamo = build();
      (deOtroPrestamo.loans.findPaymentForUpdate as jest.Mock).mockResolvedValueOnce({ id: 'pay-1', loanId: 'otro' } as never);
      await expect(deOtroPrestamo.service.reversePayment(reverseInput as never)).rejects.toThrow(/LOAN_PAYMENT_NOT_FOUND/);

      const yaReversado = build();
      (yaReversado.loans.findPaymentForUpdate as jest.Mock).mockResolvedValueOnce({
        id: 'pay-1',
        loanId: 'loan-1',
        status: 'reversed',
      } as never);
      await expect(yaReversado.service.reversePayment(reverseInput as never)).rejects.toThrow(ConflictException);
    });

    /**
     * Se deshace restando lo que ESE pago asignó, no recalculando desde cero: sin las asignaciones
     * habría que adivinar de qué cuota salió cada céntimo, y la adivinanza cambiaría según el orden
     * de los cobros posteriores.
     */
    it('resta exactamente lo asignado, reabre el préstamo y marca el cobro como reversado', async () => {
      const pagada = installment({ paidPrincipal: '100.00', paidInterest: '10.00', status: 'paid', settledAt: new Date() });
      const { service, loans, loan } = build({ loan: { status: 'paid_off', closedAt: new Date() }, installments: [pagada] });
      const payment = {
        id: 'pay-1',
        loanId: 'loan-1',
        status: 'applied',
        paymentCode: 'PAY-1',
        amount: '110.00',
        reversedAt: null,
        reversalReasonCode: null,
        updatedAtValue: null,
        save: jest.fn(async () => undefined),
      };
      (loans.findPaymentForUpdate as jest.Mock).mockResolvedValueOnce(payment as never);
      const allocation = {
        loanInstallmentId: 'i1',
        principalApplied: '100.00',
        interestApplied: '10.00',
        lateFeeApplied: '0.00',
        reversed: false,
        save: jest.fn(async () => undefined),
      };
      (loans.findAllocationsByPayment as jest.Mock).mockResolvedValueOnce([allocation] as never);

      const result = await service.reversePayment(reverseInput as never);

      expect(pagada.paidPrincipal).toBe('0.00');
      expect(pagada.paidInterest).toBe('0.00');
      expect(pagada.status).toBe('partially_paid');
      expect(pagada.settledAt).toBeNull();
      expect(allocation.reversed).toBe(true);
      expect(payment.status).toBe('reversed');
      expect(payment.reversalReasonCode).toBe('chargeback');
      // Un reverso puede reabrir un préstamo que se dio por cancelado.
      expect(loan.status).toBe('active');
      expect(loan.closedAt).toBeNull();
      expect(loan.outstandingPrincipal).toBe('100.00');
      expect(result).toMatchObject({ paymentId: 'pay-1', status: 'reversed' });
      expect((loans.createEvent as jest.Mock).mock.calls[0][0]).toMatchObject({
        eventType: 'payment_reversed',
        reasonCode: 'chargeback',
      });
    });
  });
});
