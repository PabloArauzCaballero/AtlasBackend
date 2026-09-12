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
      altasFallan?: boolean;
    } = {},
  ) {
    const rows = options.rows ?? [report()];
    const loans = options.loans ?? [loan()];
    const client = {
      canReportOutcomes: options.canReport ?? true,
      registerFacilities: jest.fn(async (..._args: unknown[]) => {
        if (options.altasFallan) throw new Error('ALTA_CAIDA');
        return [];
      }),
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
    return {
      service: new OutcomeDispatchService(client as never, reportModel as never, loanModel as never),
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
   * El alta va ANTES del desenlace y en la misma pasada: `/v1/outcomes/batch` exige que el crédito
   * exista, así que un alta que falló al desembolsar dejaría sus desenlaces fuera para siempre.
   */
  it('registra el crédito antes de mandar su desenlace, con la tasa en tanto por uno', async () => {
    const { service, client } = build();
    await service.dispatchPending({ tenantId: '1', limit: 100 });

    expect(client.registerFacilities).toHaveBeenCalled();
    const [[altas]] = client.registerFacilities.mock.calls as unknown as [[Array<Record<string, unknown>>]];
    expect(altas).toEqual([
      {
        externalReference: 'LOAN-0001',
        originationExecutionId: '88001',
        principalAmount: 1500,
        currencyCode: 'BOB',
        termMonths: 12,
        annualRate: 0.28,
        disbursedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);
    const ordenAlta = client.registerFacilities.mock.invocationCallOrder[0];
    const ordenDesenlace = client.recordFacilityOutcomes.mock.invocationCallOrder[0];
    expect(ordenAlta).toBeLessThan(ordenDesenlace);
  });

  /*
   * Un crédito sin decisión de origen no se puede registrar —el motor toma el sujeto de ella y la
   * referencia viaja en HMAC de una vía—, y eso NO debe impedir el intento del desenlace: el motor
   * lo rechazará con su motivo, que es la respuesta honesta.
   */
  it('omite el alta del préstamo que no originó ninguna decisión, sin dejar de intentar el desenlace', async () => {
    const { service, client } = build({ loans: [loan({ decisionExecutionId: null })] });
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

  /*
   * Que no se pueda reconfirmar el alta no puede frenar la entrega: puede que el crédito ya
   * estuviera registrado de una pasada anterior, y renunciar dejaría la cobertura sin moverse por un
   * problema que quizá no existe.
   */
  it('si el alta falla, sigue intentando entregar el desenlace', async () => {
    const { service, client, rows } = build({ altasFallan: true });
    const result = await service.dispatchPending({ tenantId: '1', limit: 100 });

    expect(client.recordFacilityOutcomes).toHaveBeenCalled();
    expect(result.sent).toBe(1);
    expect(rows[0].status).toBe('sent');
  });

  it('NO marca nada como enviado si la llamada falla: reencola con el error', async () => {
    const { service, rows } = build({ fails: true });
    const result = await service.dispatchPending({ tenantId: '1', limit: 100 });

    expect(result).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(rows[0].status).toBe('failed');
    expect(rows[0].sentAt).toBeNull();
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].lastError).toContain('ECONNREFUSED');
  });

  it('no intenta nada sin la credencial del plano de gestión, y explica por qué', async () => {
    const { service, client } = build({ canReport: false });
    const result = await service.dispatchPending({ tenantId: '1', limit: 100 });

    expect(result.reason).toBe('DECISION_ENGINE_OUTCOME_KEY_NOT_CONFIGURED');
    expect(client.recordFacilityOutcomes).not.toHaveBeenCalled();
  });

  it('con la cola vacía no llama al motor', async () => {
    const { service, client } = build({ rows: [] });
    const result = await service.dispatchPending({ tenantId: '1', limit: 100 });

    expect(result).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(client.recordFacilityOutcomes).not.toHaveBeenCalled();
  });

  it('deja pasar un importe ausente en vez de mandarlo como cero', async () => {
    // Cero es un importe; «no se midió» no lo es. Colapsarlos falsearía la pérdida observada.
    const { service, client } = build({ rows: [report({ amount: null })] });
    await service.dispatchPending({ tenantId: '1', limit: 100 });

    const [[outcomes]] = client.recordFacilityOutcomes.mock.calls as unknown as [[Array<{ amount?: number }>]];
    expect(outcomes[0].amount).toBeUndefined();
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
    const service = new OutcomeDispatchService(client as never, reportModel as never, loanModel as never);

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
