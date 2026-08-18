import { describe, expect, it, jest } from '@jest/globals';
import { LoanDelinquencyService, OUTCOME_SOURCE } from '../../../src/modules/loans/application/loan-delinquency.service.js';

/**
 * Barrido de mora y de cosechas.
 *
 * Dos trabajos en una pasada: recalcular el atraso de cada préstamo vivo y encolar, por cada ventana
 * de cosecha ya cumplida, la observación con la que el motor de decisión se recalibra. Lo que estas
 * pruebas fijan es el orden (la etiqueta se deriva del atraso ya recalculado), el aislamiento (un
 * préstamo que falla no puede detener la cartera) y el corte temporal de la ventana, que se mide
 * desde la DECISIÓN y no desde hoy.
 */
describe('LoanDelinquencyService.sweep', () => {
  const NOW = new Date('2026-08-18T00:00:00.000Z');

  function installment(overrides: Record<string, unknown> = {}) {
    return {
      id: 'i1',
      dueDate: '2026-01-31',
      principalAmount: '100.00',
      interestAmount: '0.00',
      lateFeeAmount: '0.00',
      paidPrincipal: '0.00',
      paidInterest: '0.00',
      paidLateFee: '0.00',
      status: 'pending',
      daysPastDue: 0,
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
      delinquencyBucket: 'current',
      daysPastDue: 0,
      worstDaysPastDue: 0,
      delinquencyEvaluatedAt: null,
      outstandingPrincipal: '100.00',
      decisionExecutionId: null,
      disbursedAt: null,
      createdAtValue: null,
      writtenOffAt: null,
      updatedAtValue: null,
      save: jest.fn(async () => undefined),
      ...options.loan,
    };
    const installments = options.installments ?? [installment()];
    const loans = {
      findActiveLoansForSweep: jest.fn(async (..._args: unknown[]) => [loan]),
      findLoanForUpdate: jest.fn(async (..._args: unknown[]) => loan),
      findInstallments: jest.fn(async (..._args: unknown[]) => installments),
      createEvent: jest.fn(async (..._args: unknown[]) => undefined),
      findOutcomeReport: jest.fn(async (..._args: unknown[]) => null),
      createOutcomeReport: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const sequelize = { transaction: jest.fn(async (callback: (t: unknown) => Promise<unknown>) => callback({})) };
    const service = new LoanDelinquencyService(loans as never, sequelize as never);
    return { service, loans, loan, installments };
  }

  it('recalcula el atraso, su tramo y el peor histórico', async () => {
    const { service, loan } = build();

    const result = await service.sweep({ tenantId: 't1', limit: 10, now: NOW });

    expect(loan.daysPastDue).toBeGreaterThan(90);
    expect(loan.delinquencyBucket).toBe('dpd_90_plus');
    expect(loan.worstDaysPastDue).toBe(loan.daysPastDue);
    expect(loan.delinquencyEvaluatedAt).toBe(NOW);
    expect(result).toMatchObject({ evaluated: 1, total: 1 });
  });

  /** Cobranza pregunta por estado, no por fecha: la cuota vencida e impaga tiene que decirlo. */
  it('marca como vencida la cuota impaga con fecha pasada', async () => {
    const { service, installments } = build();

    await service.sweep({ tenantId: 't1', limit: 10, now: NOW });

    expect(installments[0].status).toBe('overdue');
    expect(installments[0].daysPastDue).toBeGreaterThan(90);
  });

  it('no toca la cuota ya pagada aunque su fecha haya pasado', async () => {
    const pagada = installment({ paidPrincipal: '100.00', status: 'paid' });
    const { service } = build({ installments: [pagada] });

    await service.sweep({ tenantId: 't1', limit: 10, now: NOW });

    expect(pagada.status).toBe('paid');
    expect(pagada.save).not.toHaveBeenCalled();
  });

  it('registra el cambio de tramo, y sólo cuando cambia', async () => {
    const cambia = build();
    await cambia.service.sweep({ tenantId: 't1', limit: 10, now: NOW });
    expect((cambia.loans.createEvent as jest.Mock).mock.calls[0][0]).toMatchObject({
      eventType: 'delinquency_bucket_changed',
      previousStatus: 'current',
      newStatus: 'dpd_90_plus',
    });

    const yaEstaba = build({ loan: { delinquencyBucket: 'dpd_90_plus' } });
    await yaEstaba.service.sweep({ tenantId: 't1', limit: 10, now: NOW });
    expect(yaEstaba.loans.createEvent).not.toHaveBeenCalled();
  });

  it('un préstamo castigado conserva su tramo de castigo por más que el atraso crezca', async () => {
    const { service, loan } = build({ loan: { status: 'written_off' } });

    await service.sweep({ tenantId: 't1', limit: 10, now: NOW });

    expect(loan.delinquencyBucket).toBe('written_off');
  });

  /** El dato de hoy no se recupera mañana: un préstamo roto no puede detener la cartera. */
  it('sigue con el resto de la cartera cuando un préstamo falla', async () => {
    const { service, loans } = build();
    (loans.findInstallments as jest.Mock).mockRejectedValueOnce(new Error('lectura caída') as never);

    await expect(service.sweep({ tenantId: 't1', limit: 10, now: NOW })).resolves.toMatchObject({
      evaluated: 0,
      enqueued: 0,
      total: 1,
    });
  });

  describe('cosechas', () => {
    const conDecision = (overrides: Record<string, unknown> = {}) => ({
      decisionExecutionId: 'exec-1',
      disbursedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    });

    /** Una observación que el motor no puede atribuir a una ejecución no mide a ninguna versión. */
    it('no encola nada sin ejecución de decisión', async () => {
      const { service, loans } = build();
      await service.sweep({ tenantId: 't1', limit: 10, now: NOW });
      expect(loans.createOutcomeReport).not.toHaveBeenCalled();
    });

    it('encola una observación por cada ventana ya cumplida', async () => {
      const { service, loans } = build({ loan: conDecision() });

      const result = await service.sweep({ tenantId: 't1', limit: 10, now: NOW });

      const ventanas = (loans.createOutcomeReport as jest.Mock).mock.calls.map((call) => (call[0] as { windowDays: number }).windowDays);
      expect(ventanas).toEqual([30, 90, 180]);
      expect(result.enqueued).toBe(3);
      expect((loans.createOutcomeReport as jest.Mock).mock.calls[0][0]).toMatchObject({
        source: OUTCOME_SOURCE,
        status: 'pending',
        decisionExecutionId: 'exec-1',
      });
    });

    /**
     * El corte se mide desde la decisión: una ventana de 180 días evalúa lo que pasó en los 180 días
     * siguientes a decidir, y adelantarla la contaminaría con información que el modelo no tenía.
     */
    it('deja fuera la ventana que todavía no venció', async () => {
      const { service, loans } = build({ loan: conDecision({ disbursedAt: new Date('2026-06-01T00:00:00.000Z') }) });

      await service.sweep({ tenantId: 't1', limit: 10, now: NOW });

      const ventanas = (loans.createOutcomeReport as jest.Mock).mock.calls.map((call) => (call[0] as { windowDays: number }).windowDays);
      expect(ventanas).toEqual([30]);
    });

    it('no repite una observación ya encolada', async () => {
      const { service, loans } = build({ loan: conDecision() });
      (loans.findOutcomeReport as jest.Mock).mockResolvedValue({ id: 'rep-1' } as never);

      const result = await service.sweep({ tenantId: 't1', limit: 10, now: NOW });

      expect(loans.createOutcomeReport).not.toHaveBeenCalled();
      expect(result.enqueued).toBe(0);
    });
  });
});
