import { describe, expect, it, jest } from '@jest/globals';
import { RuntimeMaintenanceJobsService } from '../../../src/modules/runtime-jobs/runtime-maintenance-jobs.service.js';

/**
 * Hallazgo A-03 de `docs/audit/auditoria-integral-2026-07-30.md`: dos colas crecían sin que nada las
 * recogiera. Los mensajes de un broadcast se entregan fuera del request (fire-and-forget), así que un
 * reinicio a mitad de tanda los dejaba en `pending` para siempre; y `idempotency_keys` no se purgaba
 * nunca, degradando a la larga el propio claim que protege cada comando.
 */
describe('RuntimeMaintenanceJobsService', () => {
  const currentUser = { role: 'internal_operator', internalUserId: 'iu1', platformUserId: null } as never;

  function build() {
    const idempotencyKeyModel = { count: jest.fn(async () => 0), destroy: jest.fn(async () => 0) };
    const notificationsRepository = { listStuckMessages: jest.fn(async () => [] as Array<{ id: number }>) };
    const notificationOrchestrator = { deliverMessage: jest.fn(async () => undefined) };
    // `JobRunRecorderService` ya tiene su propio contrato; aquí solo hace falta que ejecute el
    // handler y devuelva su resultado, para poder asertar sobre lo que el job REPORTA.
    const jobRuns = {
      run: jest.fn(async (_input: unknown, handler: () => Promise<Record<string, unknown>>) => ({
        jobRunId: 'jr1',
        status: 'completed' as const,
        result: await handler(),
      })),
    };
    const service = new RuntimeMaintenanceJobsService(
      idempotencyKeyModel as never,
      notificationsRepository as never,
      notificationOrchestrator as never,
      jobRuns as never,
    );
    return { service, idempotencyKeyModel, notificationsRepository, notificationOrchestrator, jobRuns };
  }

  describe('retryStuckNotifications', () => {
    const stuckMessages = [{ id: 10 }, { id: 11 }];

    it('en dryRun cuenta los atascados sin entregar ninguno', async () => {
      const { service, notificationsRepository, notificationOrchestrator } = build();
      (notificationsRepository.listStuckMessages as jest.Mock).mockResolvedValueOnce(stuckMessages as never);

      const response = await service.retryStuckNotifications({
        tenantId: 't1',
        body: { olderThanMinutes: 15, limit: 100, dryRun: true },
        currentUser,
      });

      expect(response.result).toMatchObject({ selected: 2, retried: 0, failed: 0, dryRun: true });
      expect(notificationOrchestrator.deliverMessage).not.toHaveBeenCalled();
    });

    it('reintenta por el MISMO orquestador que la entrega normal', async () => {
      const { service, notificationsRepository, notificationOrchestrator } = build();
      (notificationsRepository.listStuckMessages as jest.Mock).mockResolvedValueOnce(stuckMessages as never);

      const response = await service.retryStuckNotifications({
        tenantId: 't1',
        body: { olderThanMinutes: 15, limit: 100, dryRun: false },
        currentUser,
      });

      expect(notificationOrchestrator.deliverMessage).toHaveBeenCalledTimes(2);
      expect(response.result).toMatchObject({ selected: 2, retried: 2, failed: 0, dryRun: false });
    });

    it('un mensaje que falla no cancela a los demás y se contabiliza aparte', async () => {
      const { service, notificationsRepository, notificationOrchestrator } = build();
      (notificationsRepository.listStuckMessages as jest.Mock).mockResolvedValueOnce(stuckMessages as never);
      (notificationOrchestrator.deliverMessage as jest.Mock)
        .mockRejectedValueOnce(new Error('NO_ADAPTER_FOR_CHANNEL_sms') as never)
        .mockResolvedValueOnce(undefined as never);

      const response = await service.retryStuckNotifications({
        tenantId: 't1',
        body: { olderThanMinutes: 15, limit: 100, dryRun: false },
        currentUser,
      });

      expect(response.result).toMatchObject({ selected: 2, retried: 1, failed: 1 });
    });

    it('pide el lote acotado por antigüedad y límite, con alcance del tenant', async () => {
      const { service, notificationsRepository } = build();

      await service.retryStuckNotifications({
        tenantId: 't7',
        body: { olderThanMinutes: 30, limit: 50, dryRun: false },
        currentUser,
      });

      expect(notificationsRepository.listStuckMessages).toHaveBeenCalledWith({ tenantId: 't7', olderThanMinutes: 30, limit: 50 });
    });

    it('queda registrado en system_job_runs con su jobCode', async () => {
      const { service, jobRuns } = build();

      await service.retryStuckNotifications({
        tenantId: 't1',
        body: { olderThanMinutes: 15, limit: 100, dryRun: true },
        currentUser,
      });

      expect((jobRuns.run as jest.Mock).mock.calls[0][0]).toMatchObject({ tenantId: 't1', jobCode: 'retry_stuck_notifications' });
    });
  });

  describe('purgeIdempotencyKeys', () => {
    it('en dryRun cuenta sin borrar', async () => {
      const { service, idempotencyKeyModel } = build();
      (idempotencyKeyModel.count as jest.Mock).mockResolvedValueOnce(42 as never);

      const response = await service.purgeIdempotencyKeys({
        tenantId: 't1',
        body: { retentionDays: 30, limit: 1000, dryRun: true },
        currentUser,
      });

      expect(response.result).toMatchObject({ selected: 42, deleted: 0, dryRun: true });
      expect(idempotencyKeyModel.destroy).not.toHaveBeenCalled();
    });

    it('NUNCA borra claves en processing: podrían pertenecer a una petición en vuelo', async () => {
      const { service, idempotencyKeyModel } = build();
      (idempotencyKeyModel.count as jest.Mock).mockResolvedValueOnce(5 as never);
      (idempotencyKeyModel.destroy as jest.Mock).mockResolvedValueOnce(5 as never);

      await service.purgeIdempotencyKeys({
        tenantId: 't1',
        body: { retentionDays: 30, limit: 1000, dryRun: false },
        currentUser,
      });

      const call = (idempotencyKeyModel.destroy as jest.Mock).mock.calls[0][0] as {
        where: { tenantScope: string; status: Record<symbol, string[]> };
        limit: number;
      };
      const statuses = Object.getOwnPropertySymbols(call.where.status).map((symbol) => call.where.status[symbol])[0];
      expect(statuses).toEqual(['completed', 'failed']);
      expect(call.where.tenantScope).toBe('t1');
      expect(call.limit).toBe(1000);
    });

    it('reporta cuántas borró y el corte aplicado', async () => {
      const { service, idempotencyKeyModel } = build();
      (idempotencyKeyModel.count as jest.Mock).mockResolvedValueOnce(9 as never);
      (idempotencyKeyModel.destroy as jest.Mock).mockResolvedValueOnce(9 as never);

      const response = await service.purgeIdempotencyKeys({
        tenantId: 't1',
        body: { retentionDays: 7, limit: 1000, dryRun: false },
        currentUser,
      });

      const result = response.result as { selected: number; deleted: number; cutoff: string };
      expect(result).toMatchObject({ selected: 9, deleted: 9, dryRun: false });
      expect(() => new Date(result.cutoff).toISOString()).not.toThrow();
    });
  });
});
