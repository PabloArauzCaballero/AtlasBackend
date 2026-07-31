import { describe, expect, it, jest } from '@jest/globals';
import { RuntimeMaintenanceJobsService } from '../../../src/modules/runtime-jobs/runtime-maintenance-jobs.service.js';

/**
 * Job `deliver_pending_notifications`: entrega los mensajes que el request dejó en `pending` a
 * propósito cuando `NOTIFICATIONS_DELIVERY_MODE=deferred`.
 *
 * Lo que distingue este job de `retry_stuck_notifications` es el corte por antigüedad, y esa
 * diferencia es todo el motivo de que exista: aquel busca lo VARADO (mensajes viejos), este lo
 * RECIÉN creado. Si alguien "simplificara" fusionándolos, la aserción sobre `olderThanMinutes: 0` es
 * lo que lo detecta.
 */
describe('RuntimeMaintenanceJobsService.deliverPendingNotifications', () => {
  const currentUser = { role: 'system', internalUserId: null, platformUserId: null } as never;

  function build() {
    const notificationsRepository = { listStuckMessages: jest.fn(async () => [] as Array<{ id: number }>) };
    const notificationOrchestrator = { deliverMessage: jest.fn(async () => undefined) };
    const jobRuns = {
      run: jest.fn(async (_input: unknown, handler: () => Promise<Record<string, unknown>>) => ({
        jobRunId: 'jr1',
        status: 'completed' as const,
        result: await handler(),
      })),
    };
    const service = new RuntimeMaintenanceJobsService(
      { count: jest.fn(), destroy: jest.fn() } as never,
      notificationsRepository as never,
      notificationOrchestrator as never,
      jobRuns as never,
    );
    return { service, notificationsRepository, notificationOrchestrator, jobRuns };
  }

  it('selecciona SIN corte por antigüedad: su pregunta es qué hay recién creado', async () => {
    const { service, notificationsRepository } = build();

    await service.deliverPendingNotifications({ tenantId: 't1', body: { limit: 50, dryRun: true }, currentUser });

    expect(notificationsRepository.listStuckMessages).toHaveBeenCalledWith({ tenantId: 't1', olderThanMinutes: 0, limit: 50 });
  });

  it('en dryRun cuenta los pendientes sin entregar ninguno', async () => {
    const { service, notificationsRepository, notificationOrchestrator } = build();
    (notificationsRepository.listStuckMessages as jest.Mock).mockResolvedValueOnce([{ id: 1 }, { id: 2 }] as never);

    const response = await service.deliverPendingNotifications({
      tenantId: 't1',
      body: { limit: 100, dryRun: true },
      currentUser,
    });

    expect(response.result).toEqual({ selected: 2, delivered: 0, failed: 0, dryRun: true });
    expect(notificationOrchestrator.deliverMessage).not.toHaveBeenCalled();
  });

  it('entrega cada mensaje por el MISMO orquestador que la entrega normal', async () => {
    const { service, notificationsRepository, notificationOrchestrator } = build();
    const messages = [{ id: 1 }, { id: 2 }, { id: 3 }];
    (notificationsRepository.listStuckMessages as jest.Mock).mockResolvedValueOnce(messages as never);

    const response = await service.deliverPendingNotifications({
      tenantId: 't1',
      body: { limit: 100, dryRun: false },
      currentUser,
    });

    expect(notificationOrchestrator.deliverMessage).toHaveBeenCalledTimes(3);
    expect(notificationOrchestrator.deliverMessage).toHaveBeenCalledWith(messages[0]);
    expect(response.result).toEqual({ selected: 3, delivered: 3, failed: 0, dryRun: false });
  });

  it('un mensaje que falla no cancela a los demás: se cuenta y se sigue', async () => {
    const { service, notificationsRepository, notificationOrchestrator } = build();
    (notificationsRepository.listStuckMessages as jest.Mock).mockResolvedValueOnce([{ id: 1 }, { id: 2 }] as never);
    (notificationOrchestrator.deliverMessage as jest.Mock)
      .mockRejectedValueOnce(new Error('adaptador caído') as never)
      .mockResolvedValueOnce(undefined as never);

    const response = await service.deliverPendingNotifications({
      tenantId: 't1',
      body: { limit: 100, dryRun: false },
      currentUser,
    });

    expect(response.result).toEqual({ selected: 2, delivered: 1, failed: 1, dryRun: false });
  });

  it('registra la ejecución en system_job_runs con su propio jobCode', async () => {
    const { service, jobRuns } = build();

    await service.deliverPendingNotifications({ tenantId: 't1', body: { limit: 10, dryRun: true }, currentUser });

    expect(jobRuns.run).toHaveBeenCalledWith(
      expect.objectContaining({ jobCode: 'deliver_pending_notifications', tenantId: 't1' }),
      expect.any(Function),
    );
  });
});
