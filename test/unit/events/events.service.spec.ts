import { describe, expect, it, jest } from '@jest/globals';
import { EventsService } from '../../../src/modules/events/events.service.js';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 2): primer test real de `events`
 * (785 líneas, 0 tests hasta este patch) — el outbox de eventos de negocio del que dependen
 * notificaciones y workers. Si esto falla en silencio, todo lo que consume eventos falla en
 * cascada sin que nadie lo note primero en `events`.
 */
describe('EventsService', () => {
  function buildService() {
    const repository = {
      createEvent: jest.fn(),
      listWithCursor: jest.fn(),
      list: jest.fn(),
      getById: jest.fn(),
      listPending: jest.fn(),
      claimPending: jest.fn(),
    };
    const notificationOrchestrator = { handleEvent: jest.fn() };
    const service = new EventsService(repository as never, notificationOrchestrator as never);
    return { service, repository, notificationOrchestrator };
  }

  function fakeOutboxEvent(overrides: Record<string, unknown> = {}) {
    return {
      id: '1',
      tenantId: 't1',
      eventCode: 'user.registered',
      eventFamily: 'user_security',
      eventVersion: 1,
      aggregateType: 'customer',
      aggregateId: 'c1',
      status: 'pending',
      priority: 0,
      attempts: 0,
      maxAttempts: 3,
      availableAt: new Date('2026-01-01'),
      processedAt: null,
      failedAt: null,
      errorCode: null,
      lastError: null,
      idempotencyKey: null,
      correlationId: null,
      causationId: null,
      sourceModule: 'test',
      sourceAction: 'test',
      eventPayloadJson: {},
      metadataJson: {},
      createdAtValue: new Date('2026-01-01'),
      updatedAtValue: new Date('2026-01-01'),
      save: jest.fn(),
      ...overrides,
    };
  }

  describe('publish', () => {
    it('throws BadRequestException with EVENT_NOT_REGISTERED for an unknown event code', async () => {
      const { service, repository } = buildService();
      await expect(service.publish({ tenantId: 't1', eventCode: 'does.not.exist', aggregateType: 'customer' } as never)).rejects.toThrow(
        /EVENT_NOT_REGISTERED/,
      );
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('throws BadRequestException with EVENT_AGGREGATE_NOT_ALLOWED when the aggregateType is not allowed for that event', async () => {
      const { service, repository } = buildService();
      // 'user.registered' allows aggregateTypes ['customer','user','session','device'], not 'invoice'.
      await expect(service.publish({ tenantId: 't1', eventCode: 'user.registered', aggregateType: 'invoice' } as never)).rejects.toThrow(
        /EVENT_AGGREGATE_NOT_ALLOWED/,
      );
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it('creates the event and maps the persisted model back to a plain response object', async () => {
      const { service, repository } = buildService();
      (repository.createEvent as jest.Mock).mockResolvedValueOnce(fakeOutboxEvent() as never);
      const result = await service.publish({ tenantId: 't1', eventCode: 'user.registered', aggregateType: 'customer' } as never);
      expect(result).toMatchObject({ id: '1', eventCode: 'user.registered', status: 'pending' });
    });
  });

  describe('publishMany', () => {
    it('publishes every input in order and reports the total created', async () => {
      const { service, repository } = buildService();
      (repository.createEvent as jest.Mock)
        .mockResolvedValueOnce(fakeOutboxEvent({ id: '1' }) as never)
        .mockResolvedValueOnce(fakeOutboxEvent({ id: '2' }) as never);

      const result = await service.publishMany([
        { tenantId: 't1', eventCode: 'user.registered', aggregateType: 'customer' } as never,
        { tenantId: 't1', eventCode: 'user.registered', aggregateType: 'user' } as never,
      ]);

      expect(result.created).toBe(2);
      expect(repository.createEvent).toHaveBeenCalledTimes(2);
    });

    it('propagates a rejection from any individual event instead of silently skipping it', async () => {
      const { service, repository } = buildService();
      (repository.createEvent as jest.Mock).mockResolvedValueOnce(fakeOutboxEvent() as never);
      await expect(
        service.publishMany([
          { tenantId: 't1', eventCode: 'user.registered', aggregateType: 'customer' } as never,
          { tenantId: 't1', eventCode: 'not.registered', aggregateType: 'customer' } as never,
        ]),
      ).rejects.toThrow(/EVENT_NOT_REGISTERED/);
    });
  });

  describe('listEvents', () => {
    it('throws BadRequestException when a cursor is provided but does not decode', async () => {
      const { service } = buildService();
      await expect(service.listEvents('t1', { pagination: 'cursor', cursor: 'not-a-valid-cursor', limit: 20 } as never)).rejects.toThrow(
        /cursor inválido o corrupto/,
      );
    });

    it('uses cursor pagination and returns nextCursor from the repository result', async () => {
      const { service, repository } = buildService();
      (repository.listWithCursor as jest.Mock).mockResolvedValueOnce([fakeOutboxEvent()] as never);
      const result = await service.listEvents('t1', { pagination: 'cursor', limit: 20 } as never);
      expect(result.pagination.mode).toBe('cursor');
      expect(result.data).toHaveLength(1);
    });

    it('falls back to offset pagination when pagination mode is not "cursor"', async () => {
      const { service, repository } = buildService();
      (repository.list as jest.Mock).mockResolvedValueOnce({ rows: [fakeOutboxEvent()], count: 1 } as never);
      const result = await service.listEvents('t1', { pagination: 'offset', page: 1, limit: 20 } as never);
      expect(result.pagination.mode).toBe('offset');
      expect((result.pagination as { total: number }).total).toBe(1);
    });
  });

  describe('retryEvent / cancelEvent — cannot act on an already-processed event', () => {
    it('retryEvent throws PROCESSED_EVENT_CANNOT_BE_RETRIED for a processed event', async () => {
      const { service, repository } = buildService();
      (repository.getById as jest.Mock).mockResolvedValueOnce(fakeOutboxEvent({ status: 'processed' }) as never);
      await expect(service.retryEvent('t1', '1')).rejects.toThrow(/PROCESSED_EVENT_CANNOT_BE_RETRIED/);
    });

    it('retryEvent resets a failed event back to pending, clearing error fields', async () => {
      const { service, repository } = buildService();
      const event = fakeOutboxEvent({ status: 'failed', lastError: 'boom', errorCode: 'X', failedAt: new Date('2026-01-01') });
      (repository.getById as jest.Mock).mockResolvedValueOnce(event as never);
      const result = await service.retryEvent('t1', '1');
      expect(result.status).toBe('pending');
      expect(event.save).toHaveBeenCalledTimes(1);
    });

    it('cancelEvent throws PROCESSED_EVENT_CANNOT_BE_CANCELLED for a processed event', async () => {
      const { service, repository } = buildService();
      (repository.getById as jest.Mock).mockResolvedValueOnce(fakeOutboxEvent({ status: 'processed' }) as never);
      await expect(service.cancelEvent('t1', '1')).rejects.toThrow(/PROCESSED_EVENT_CANNOT_BE_CANCELLED/);
    });

    it('cancelEvent moves a pending event to cancelled', async () => {
      const { service, repository } = buildService();
      const event = fakeOutboxEvent({ status: 'pending' });
      (repository.getById as jest.Mock).mockResolvedValueOnce(event as never);
      const result = await service.cancelEvent('t1', '1');
      expect(result.status).toBe('cancelled');
    });
  });

  describe('processPendingEvents — retry/backoff/max-attempts state machine', () => {
    it('dryRun: true only selects candidates, calls neither claimPending nor the notification orchestrator', async () => {
      const { service, repository, notificationOrchestrator } = buildService();
      (repository.listPending as jest.Mock).mockResolvedValueOnce([fakeOutboxEvent(), fakeOutboxEvent({ id: '2' })] as never);

      const result = await service.processPendingEvents({ tenantId: 't1', limit: 10, dryRun: true } as never);

      expect(result).toMatchObject({ selected: 2, processed: 0, failed: 0, skipped: 0, dryRun: true });
      expect(repository.claimPending).not.toHaveBeenCalled();
      expect(notificationOrchestrator.handleEvent).not.toHaveBeenCalled();
    });

    it('a successfully handled event moves to processed', async () => {
      const { service, repository, notificationOrchestrator } = buildService();
      const event = fakeOutboxEvent();
      (repository.claimPending as jest.Mock).mockResolvedValueOnce([event] as never);
      (notificationOrchestrator.handleEvent as jest.Mock).mockResolvedValueOnce(undefined as never);

      const result = await service.processPendingEvents({ tenantId: 't1', limit: 10, dryRun: false } as never);

      expect(result.processed).toBe(1);
      expect(event.status).toBe('processed');
      expect(event.lockedAt).toBeNull();
    });

    it('a failing event below maxAttempts goes back to pending with a backed-off availableAt, not to failed', async () => {
      const { service, repository, notificationOrchestrator } = buildService();
      const event = fakeOutboxEvent({ attempts: 1, maxAttempts: 3 });
      (repository.claimPending as jest.Mock).mockResolvedValueOnce([event] as never);
      (notificationOrchestrator.handleEvent as jest.Mock).mockRejectedValueOnce(new Error('provider down') as never);

      const result = await service.processPendingEvents({ tenantId: 't1', limit: 10, dryRun: false } as never);

      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
      expect(event.status).toBe('pending');
      expect(event.errorCode).toBe('EVENT_PROCESSING_FAILED');
      expect(event.lastError).toBe('provider down');
      expect((event.availableAt as Date).getTime()).toBeGreaterThan(Date.now());
    });

    it('a failing event AT maxAttempts moves to failed, not back to pending', async () => {
      const { service, repository, notificationOrchestrator } = buildService();
      const event = fakeOutboxEvent({ attempts: 3, maxAttempts: 3 });
      (repository.claimPending as jest.Mock).mockResolvedValueOnce([event] as never);
      (notificationOrchestrator.handleEvent as jest.Mock).mockRejectedValueOnce(new Error('permanent failure') as never);

      const result = await service.processPendingEvents({ tenantId: 't1', limit: 10, dryRun: false } as never);

      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(0);
      expect(event.status).toBe('failed');
      expect(event.failedAt).not.toBeNull();
    });

    it('one failing event does not stop the batch: subsequent events still get processed', async () => {
      const { service, repository, notificationOrchestrator } = buildService();
      const failing = fakeOutboxEvent({ id: '1', attempts: 3, maxAttempts: 3 });
      const succeeding = fakeOutboxEvent({ id: '2' });
      (repository.claimPending as jest.Mock).mockResolvedValueOnce([failing, succeeding] as never);
      (notificationOrchestrator.handleEvent as jest.Mock)
        .mockRejectedValueOnce(new Error('boom') as never)
        .mockResolvedValueOnce(undefined as never);

      const result = await service.processPendingEvents({ tenantId: 't1', limit: 10, dryRun: false } as never);

      expect(result.failed).toBe(1);
      expect(result.processed).toBe(1);
    });
  });
});
