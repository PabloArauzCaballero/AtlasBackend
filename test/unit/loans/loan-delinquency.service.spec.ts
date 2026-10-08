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
      markDelinquencyEvaluated: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const sequelize = { transaction: jest.fn(async (callback: (t: unknown) => Promise<unknown>) => callback({})) };
    /*
     * La linea de credito.
     *
     * El barrido dejo de limitarse a escribir el tramo de mora: cuando el tramo CAMBIA, traslada el
     * cambio a la capacidad de pago. Es lo que convierte «entrar en mora te cuesta» de una frase de
     * la pantalla en algo que ocurre solo. Se simula porque el recalculo real llama al motor.
     */
    const creditLines = { recalculate: jest.fn(async (..._args: unknown[]) => ({ id: '1' })) };
    const service = new LoanDelinquencyService(loans as never, creditLines as never, sequelize as never);
    return { service, loans, loan, installments, creditLines };
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

  /**
   * El castigo deja las cuotas impagas en `written_off` con su saldo intacto. El barrido las volvía
   * `overdue` y el castigo desaparecía del calendario y de las cuotas cobrables.
   */
  it('no devuelve a «vencida» la cuota de un préstamo castigado', async () => {
    const castigada = installment({ status: 'written_off' });
    const { service } = build({ loan: { status: 'written_off' }, installments: [castigada] });

    await service.sweep({ tenantId: 't1', limit: 10, now: NOW });

    expect(castigada.status).toBe('written_off');
    expect(castigada.save).not.toHaveBeenCalled();
  });

  it('tampoco toca una cuota castigada aunque el préstamo siga activo', async () => {
    const castigada = installment({ status: 'written_off' });
    const { service } = build({ installments: [castigada] });

    await service.sweep({ tenantId: 't1', limit: 10, now: NOW });

    expect(castigada.status).toBe('written_off');
  });

  /** El atraso por cuota se quedaba en el valor del primer barrido: una cuota de 45 días decía 1. */
  it('recalcula en cada pasada el atraso de la cuota ya vencida', async () => {
    // NOW es 2026-08-17 a las 20:00 en Bolivia: 44 días después del 4 de julio.
    const vencida = installment({ status: 'overdue', dueDate: '2026-07-04', daysPastDue: 1 });
    const { service } = build({ installments: [vencida] });

    await service.sweep({ tenantId: 't1', limit: 10, now: NOW });

    expect(vencida.daysPastDue).toBe(44);
    expect(vencida.save).toHaveBeenCalled();
  });

  /**
   * La cuota vence al final del día en BOLIVIA. A las 20:00 de La Paz ya es mañana en UTC, y el
   * barrido de esa noche la daba por vencida a un cliente que todavía estaba en plazo.
   */
  it('cuenta el vencimiento en hora de Bolivia, no en UTC', async () => {
    const deHoy = installment({ dueDate: '2026-10-05' });
    const enPlazo = build({ installments: [deHoy] });
    await enPlazo.service.sweep({ tenantId: 't1', limit: 10, now: new Date('2026-10-06T02:00:00.000Z') });
    expect(deHoy.status).toBe('pending');
    expect(enPlazo.loan.delinquencyBucket).toBe('current');

    const alDiaSiguiente = installment({ dueDate: '2026-10-05' });
    const vencida = build({ installments: [alDiaSiguiente] });
    await vencida.service.sweep({ tenantId: 't1', limit: 10, now: new Date('2026-10-06T04:00:00.000Z') });
    expect(alDiaSiguiente.status).toBe('overdue');
    expect(vencida.loan.delinquencyBucket).toBe('dpd_1_29');
  });

  /**
   * Un préstamo que falla siempre conservaba la marca más antigua y volvía al principio de cada
   * lote: con tantos rotos como el límite, nadie más se evaluaba.
   */
  it('avanza la marca del préstamo que falló para que no bloquee el lote', async () => {
    const { service, loans } = build();
    (loans.findInstallments as jest.Mock).mockRejectedValueOnce(new Error('dato roto') as never);

    await service.sweep({ tenantId: 't1', limit: 10, now: NOW });

    expect(loans.markDelinquencyEvaluated).toHaveBeenCalledWith('t1', 'loan-1', NOW);
  });

  it('si ni la marca se puede avanzar, el barrido sigue', async () => {
    const { service, loans } = build();
    (loans.findInstallments as jest.Mock).mockRejectedValueOnce(new Error('dato roto') as never);
    (loans.markDelinquencyEvaluated as jest.Mock).mockRejectedValueOnce(new Error('base caída') as never);

    await expect(service.sweep({ tenantId: 't1', limit: 10, now: NOW })).resolves.toMatchObject({ evaluated: 0, total: 1 });
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
