import { describe, expect, it, jest } from '@jest/globals';
import { OutcomeDispatchService } from '../../../src/modules/decision-engine/outcome-dispatch.service.js';

/**
 * Entrega de desenlaces al motor.
 *
 * El desenlace de una cosecha es el único dato del sistema que no se puede reconstruir más tarde:
 * su ventana ya pasó. De ahí la propiedad central de estas pruebas — **un fallo no marca nada como
 * enviado**. Dar por entregado un lote que quizá no llegó pierde para siempre la medida del acierto
 * del modelo, y lo hace en silencio.
 */
describe('OutcomeDispatchService', () => {
  function report(overrides: Record<string, unknown> = {}) {
    return {
      id: 'r1',
      loanId: 'l1',
      decisionExecutionId: '88001',
      windowDays: 90,
      label: 'BAD',
      amount: '1250.0000',
      source: 'ATLAS_LOAN_BOOK',
      notes: null,
      status: 'pending',
      attempts: 0,
      lastError: null,
      observedAt: new Date('2026-05-01T00:00:00Z'),
      sentAt: null,
      save: jest.fn(),
      ...overrides,
    };
  }

  /** El préstamo que el informe cita. Su CÓDIGO es lo que el motor conoce como crédito. */
  function loan(overrides: Record<string, unknown> = {}) {
    return {
      id: 'l1',
      loanCode: 'LOAN-0001',
      decisionExecutionId: '88001',
      principalAmount: '1500.00',
      currencyCode: 'BOB',
      termMonths: 12,
      annualInterestRate: '0.2800',
      disbursedAt: new Date('2026-02-01T00:00:00Z'),
      ...overrides,
    };
  }

  function build(
    options: {
      canReport?: boolean;
      rows?: Record<string, unknown>[];
      loans?: Record<string, unknown>[];
      fails?: boolean;
      rechazos?: Array<{ externalReference: string; windowDays: number; accepted: boolean; reason: string | null }>;
    } = {},
  ) {
    const rows = options.rows ?? [report()];
    const loans = options.loans ?? [loan()];
    const client = {
      canReportOutcomes: options.canReport ?? true,
      // Se dobla para comprobar que este servicio NO lo llama: el alta es de otro trabajo.
      registerFacilities: jest.fn(async (..._args: unknown[]) => []),
      recordFacilityOutcomes: jest.fn(async (...args: unknown[]) => {
        if (options.fails) throw new Error('ECONNREFUSED');
        if (options.rechazos) return options.rechazos;
        return (args[0] as Array<{ externalReference: string; windowDays: number }>).map((row) => ({
          externalReference: row.externalReference,
          windowDays: row.windowDays,
          accepted: true,
          reason: null,
        }));
      }),
    };
    const reportModel = { findAll: jest.fn(async (..._args: unknown[]) => rows) };
    const loanModel = { findAll: jest.fn(async (..._args: unknown[]) => loans) };
    for (const prestamo of loans) {
      (prestamo as Record<string, unknown>).save ??= jest.fn(async () => prestamo);
      (prestamo as Record<string, unknown>).decisionFacilityRegisteredAt ??= null;
    }
    return {
      service: new OutcomeDispatchService(
        client as never,
        reportModel as never,
        loanModel as never,
        // El servicio de alta se dobla: desde aquí sólo se comprueba que el despacho NO lo usa.
        { registrarCreditosNuevos: jest.fn() } as never,
      ),
      client,
      rows,
    };
  }

  /*
   * La prueba que fija el arreglo del 2026-09-12: el desenlace se manda por el endpoint que CIERRA
   * la ventana, identificado por el CRÉDITO. `/v1/model-monitoring/outcomes` guardaba la observación
   * sin tocar `outcome_window_schedule`, así que la ventana seguía en la cola de pendientes para
   * siempre y el denominador de la cobertura no se movía nunca.
   */
  it('entrega el lote por el crédito —no por la ejecución— y lo marca como enviado', async () => {
    const { service, client, rows } = build();
    const result = await service.dispatchPending({ tenantId: '1', limit: 100 });

    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(rows[0].status).toBe('sent');
    expect(rows[0].sentAt).toBeInstanceOf(Date);
    const [[outcomes]] = client.recordFacilityOutcomes.mock.calls as unknown as [[unknown[]]];
    expect(outcomes).toEqual([
      {
        externalReference: 'LOAN-0001',
        windowDays: 90,
        label: 'BAD',
        amount: 1250,
        source: 'ATLAS_LOAN_BOOK',
        notes: undefined,
      },
    ]);
  });

  /*
   * El despacho NO registra el crédito, y esa división es la que esta prueba fija.
   *
   * Dar de alta antes de cada envío sería un segundo camino para lo que ya hace el trabajo
   * `register_engine_facilities`. Un desenlace cuyo crédito aún no está registrado se rechaza con
   * `FACILITY_NOT_FOUND`, se queda en la cola y entra en el envío siguiente.
   */
  it('no da de alta créditos: eso es de otro trabajo', async () => {
    const { service, client } = build();
    await service.dispatchPending({ tenantId: '1', limit: 100 });

    expect(client.registerFacilities).not.toHaveBeenCalled();
    expect(client.recordFacilityOutcomes).toHaveBeenCalled();
  });

  /*
   * Fila a fila y no el lote entero: el motor devuelve el veredicto de CADA desenlace justamente
   * para no tener que reenviar el archivo completo por dos filas malas. Darlas todas por enviadas
   * perdería las rechazadas para siempre, porque su ventana ya pasó.
   */
  it('marca enviada la fila aceptada y reencola la rechazada, en el mismo lote', async () => {
    const filas = [report({ id: 'r1' }), report({ id: 'r2', windowDays: 180 })];
    const { service, rows } = build({
      rows: filas,
      rechazos: [
        { externalReference: 'LOAN-0001', windowDays: 90, accepted: true, reason: null },
        { externalReference: 'LOAN-0001', windowDays: 180, accepted: false, reason: 'FACILITY_NOT_FOUND' },
      ],
    });
    const result = await service.dispatchPending({ tenantId: '1', limit: 100 });

    expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(rows[0].status).toBe('sent');
    expect(rows[1].status).toBe('failed');
    expect(rows[1].lastError).toBe('FACILITY_NOT_FOUND');
  });

  /*
   * Una fila huérfana —su préstamo ya no existe— se cierra en vez de reintentarse: si no, el lote
   * nunca avanza y los desenlaces buenos se quedan detrás de ella para siempre.
   */
  it('cierra el informe cuyo préstamo ya no existe en vez de reintentarlo sin fin', async () => {
    const { service, client, rows } = build({ loans: [] });
    const result = await service.dispatchPending({ tenantId: '1', limit: 100 });

    expect(result).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(rows[0].status).toBe('failed');
    expect(rows[0].attempts).toBe(6);
    expect(rows[0].lastError).toContain('LOAN_NOT_FOUND');
    expect(client.recordFacilityOutcomes).not.toHaveBeenCalled();
  });

  it('lista los desenlaces que agotaron los reintentos', async () => {
    const { service } = build({ rows: [report({ status: 'failed', attempts: 6, lastError: 'HTTP 500' })] });
    const result = await service.listExhausted('1', 50);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ decisionExecutionId: '88001', windowDays: 90, attempts: 6 });
  });

  /*
   * El resumen que sustituye al botón «Entregar desenlaces» del portal: ahora entrega un job, y lo
   * que hay que poder ver es si va al día.
   */
  it('summarize devuelve la cola en cuatro cifras, el más antiguo y la última entrega', async () => {
    const counts: Record<string, number> = { pending: 4, retrying: 1, exhausted: 2, sent: 40 };
    const reportModel = {
      findAll: jest.fn(async (..._args: unknown[]) => []),
      count: jest.fn(async (options: { where: { status: string; attempts?: unknown } }) => {
        if (options.where.status === 'pending') return counts.pending;
        if (options.where.status === 'sent') return counts.sent;
        return options.where.attempts &&
          Object.getOwnPropertySymbols(options.where.attempts).length > 0 &&
          String(Object.getOwnPropertySymbols(options.where.attempts)[0]).includes('gte')
          ? counts.exhausted
          : counts.retrying;
      }),
      min: jest.fn(async (..._args: unknown[]) => new Date('2026-08-01T00:00:00.000Z')),
      max: jest.fn(async (..._args: unknown[]) => new Date('2026-09-07T10:00:00.000Z')),
    };
    const client = { canReportOutcomes: true, registerFacilities: jest.fn(), recordFacilityOutcomes: jest.fn() };
    const loanModel = { findAll: jest.fn(async (..._args: unknown[]) => []) };
    const service = new OutcomeDispatchService(
      client as never,
      reportModel as never,
      loanModel as never,
      { registrarCreditosNuevos: jest.fn() } as never,
    );

    const result = await service.summarize('1');

    expect(result).toEqual({
      pending: 4,
      retrying: 1,
      exhausted: 2,
      sent: 40,
      oldestPendingObservedAt: new Date('2026-08-01T00:00:00.000Z'),
      lastSentAt: new Date('2026-09-07T10:00:00.000Z'),
      configured: true,
      maxAttempts: 6,
    });
    // Todas las cuentas van acotadas al tenant: la cola de otro inquilino no es asunto de esta pantalla.
    for (const call of reportModel.count.mock.calls as unknown as [{ where: { tenantId?: string } }][]) {
      expect(call[0].where.tenantId).toBe('1');
    }
  });
});
