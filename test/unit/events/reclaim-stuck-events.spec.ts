import { describe, expect, it, jest } from '@jest/globals';
import { EventsService } from '../../../src/modules/events/events.service.js';

/**
 * Recuperación de eventos varados en `processing`.
 *
 * El fallo que cubre: `claimPending` marca el evento como `processing` en una transacción y lo
 * resuelve en otra escritura posterior. Si el proceso muere entre ambas —despliegue, OOM, SIGKILL—
 * el evento queda bloqueado para siempre, porque toda consulta de reclamo filtra por
 * `status='pending'`. Era la única cola del sistema con pérdida permanente y silenciosa: ni error,
 * ni alerta, ni fila en ninguna cola de fallidos. Simplemente un aviso que nunca sale.
 */
describe('EventsService.reclaimStuckEvents', () => {
  function build() {
    const repository = {
      reclaimStuckProcessing: jest.fn(async () => ({ requeued: 2, deadLettered: 1, eventIds: ['10', '11', '12'] })),
      countStuckProcessing: jest.fn(async () => 5),
    };
    const service = new EventsService(repository as never, {} as never);
    return { service, repository };
  }

  it('devuelve a la cola los varados y reporta cuántos cayeron a dead-letter', async () => {
    const { service, repository } = build();

    const result = await service.reclaimStuckEvents({ tenantId: '7', olderThanMinutes: 15, limit: 100, dryRun: false });

    expect(result).toMatchObject({ selected: 3, requeued: 2, deadLettered: 1, dryRun: false });
    expect(repository.reclaimStuckProcessing).toHaveBeenCalledWith(expect.objectContaining({ tenantId: '7', limit: 100 }));
  });

  it('calcula el corte restando olderThanMinutes al momento actual', async () => {
    const { service, repository } = build();
    const before = Date.now();

    await service.reclaimStuckEvents({ tenantId: '7', olderThanMinutes: 30, limit: 50, dryRun: false });

    const { olderThan } = (repository.reclaimStuckProcessing as jest.Mock).mock.calls[0][0] as { olderThan: Date };
    // El corte debe caer 30 minutos atrás; se comprueba con holgura para no depender del reloj.
    expect(before - olderThan.getTime()).toBeGreaterThanOrEqual(30 * 60_000);
    expect(before - olderThan.getTime()).toBeLessThan(30 * 60_000 + 5_000);
  });

  it('en dryRun cuenta pero no toca ninguna fila', async () => {
    const { service, repository } = build();

    const result = await service.reclaimStuckEvents({ tenantId: '7', olderThanMinutes: 15, limit: 100, dryRun: true });

    expect(result).toMatchObject({ selected: 5, requeued: 0, deadLettered: 0, dryRun: true });
    expect(repository.reclaimStuckProcessing).not.toHaveBeenCalled();
    expect(repository.countStuckProcessing).toHaveBeenCalledWith(expect.objectContaining({ tenantId: '7' }));
  });

  it('sin eventos varados no registra ruido: es el caso normal', async () => {
    const { service, repository } = build();
    (repository.reclaimStuckProcessing as jest.Mock).mockResolvedValueOnce({
      requeued: 0,
      deadLettered: 0,
      eventIds: [],
    } as never);
    const warn = jest.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');

    const result = await service.reclaimStuckEvents({ tenantId: '7', olderThanMinutes: 15, limit: 100, dryRun: false });

    expect(result.selected).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('registra los IDs recuperados: un evento varado siempre significa que un proceso murió a medias', async () => {
    const { service } = build();
    const warn = jest.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');

    await service.reclaimStuckEvents({ tenantId: '7', olderThanMinutes: 15, limit: 100, dryRun: false });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('10, 11, 12'));
  });
});

/**
 * Reintento manual de un evento en dead-letter. El operador que pulsa "reintentar" pide otra
 * oportunidad real, no un intento único que muere al primer fallo.
 */
describe('EventsService.retryEvent', () => {
  function buildEvent(overrides: Record<string, unknown> = {}) {
    return {
      status: 'failed',
      attempts: 3,
      maxAttempts: 3,
      lockedAt: new Date(),
      lockedBy: 'worker-1',
      failedAt: new Date(),
      lastError: 'boom',
      errorCode: 'EVENT_PROCESSING_FAILED',
      availableAt: new Date(0),
      updatedAtValue: new Date(0),
      id: 42,
      eventCode: 'customer.created',
      save: jest.fn(async () => undefined),
      ...overrides,
    };
  }

  it('devuelve el presupuesto de intentos y suelta el bloqueo', async () => {
    const event = buildEvent();
    const repository = { getById: jest.fn(async () => event) };
    const service = new EventsService(repository as never, {} as never);

    await service.retryEvent('7', '42');

    // Sin reponer `attempts`, `claimPending` lo reclamaba sumando uno más y el PRIMER fallo lo
    // devolvía a `failed`: el reintento manual no reintentaba nada.
    expect(event.attempts).toBe(0);
    expect(event.status).toBe('pending');
    expect(event.lockedAt).toBeNull();
    expect(event.lockedBy).toBeNull();
    expect(event.failedAt).toBeNull();
    expect(event.save).toHaveBeenCalled();
  });

  it('un evento ya procesado no se reintenta: sería duplicar un efecto ya aplicado', async () => {
    const event = buildEvent({ status: 'processed' });
    const repository = { getById: jest.fn(async () => event) };
    const service = new EventsService(repository as never, {} as never);

    await expect(service.retryEvent('7', '42')).rejects.toThrow('PROCESSED_EVENT_CANNOT_BE_RETRIED');
    expect(event.save).not.toHaveBeenCalled();
  });
});
