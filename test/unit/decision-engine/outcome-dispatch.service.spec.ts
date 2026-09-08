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

  function build(options: { canReport?: boolean; rows?: Record<string, unknown>[]; fails?: boolean } = {}) {
    const rows = options.rows ?? [report()];
    const client = {
      canReportOutcomes: options.canReport ?? true,
      recordOutcomes: jest.fn(async (..._args: unknown[]) => {
        if (options.fails) throw new Error('ECONNREFUSED');
      }),
    };
    const reportModel = { findAll: jest.fn(async (..._args: unknown[]) => rows) };
    return { service: new OutcomeDispatchService(client as never, reportModel as never), client, rows };
  }

  it('entrega el lote y lo marca como enviado', async () => {
    const { service, client, rows } = build();
    const result = await service.dispatchPending({ tenantId: '1', limit: 100 });

    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(rows[0].status).toBe('sent');
    expect(rows[0].sentAt).toBeInstanceOf(Date);
    const [[observations]] = client.recordOutcomes.mock.calls as unknown as [[unknown[]]];
    expect(observations).toEqual([
      {
        executionId: '88001',
        windowDays: 90,
        label: 'BAD',
        amount: 1250,
        source: 'ATLAS_LOAN_BOOK',
        notes: undefined,
      },
    ]);
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
    expect(client.recordOutcomes).not.toHaveBeenCalled();
  });

  it('con la cola vacía no llama al motor', async () => {
    const { service, client } = build({ rows: [] });
    const result = await service.dispatchPending({ tenantId: '1', limit: 100 });

    expect(result).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(client.recordOutcomes).not.toHaveBeenCalled();
  });

  it('deja pasar un importe ausente en vez de mandarlo como cero', async () => {
    // Cero es un importe; «no se midió» no lo es. Colapsarlos falsearía la pérdida observada.
    const { service, client } = build({ rows: [report({ amount: null })] });
    await service.dispatchPending({ tenantId: '1', limit: 100 });

    const [[observations]] = client.recordOutcomes.mock.calls as unknown as [[Array<{ amount?: number }>]];
    expect(observations[0].amount).toBeUndefined();
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
        return options.where.attempts && Object.getOwnPropertySymbols(options.where.attempts).length > 0 &&
          String(Object.getOwnPropertySymbols(options.where.attempts)[0]).includes('gte')
          ? counts.exhausted
          : counts.retrying;
      }),
      min: jest.fn(async (..._args: unknown[]) => new Date('2026-08-01T00:00:00.000Z')),
      max: jest.fn(async (..._args: unknown[]) => new Date('2026-09-07T10:00:00.000Z')),
    };
    const client = { canReportOutcomes: true, recordOutcomes: jest.fn() };
    const service = new OutcomeDispatchService(client as never, reportModel as never);

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
