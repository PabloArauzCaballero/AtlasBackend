import { describe, expect, it, jest } from '@jest/globals';
import { RuntimeJobsController } from '../../../src/modules/runtime-jobs/runtime-jobs.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';

/**
 * `RuntimeJobsController` expone jobs de mantenimiento (outbox, eventos, expiración de sesiones,
 * retención, calidad de datos), todos vía el helper `requireHeaders` (exige x-idempotency-key +
 * parsea tenant). Spec directo con el servicio mockeado.
 */
describe('RuntimeJobsController', () => {
  function build() {
    const service = {
      processOutbox: jest.fn(async () => ({ processed: 1 })),
      processEvents: jest.fn(async () => ({ processed: 2 })),
      expireStaleSessions: jest.fn(async () => ({ expired: 3 })),
      applyRetentionPolicies: jest.fn(async () => ({ applied: 4 })),
      recalculateDataQuality: jest.fn(async () => ({ recalculated: 5 })),
    };
    // Los dos jobs de saneamiento viven en `RuntimeMaintenanceJobsService` (extraídos para no seguir
    // engordando `runtime-jobs.service.ts`, que ya estaba muy por encima del límite de tamaño).
    const maintenance = {
      retryStuckNotifications: jest.fn(async () => ({ retried: 6 })),
      purgeIdempotencyKeys: jest.fn(async () => ({ deleted: 7 })),
    };
    return { controller: new RuntimeJobsController(service as never, maintenance as never), service, maintenance };
  }
  const user = { role: 'admin', tenantId: '1', internalUserId: 'u1' } as never;
  const key = 'idem-key-123';

  it('processOutbox delega con { tenantId, body, currentUser }', async () => {
    const { controller, service } = build();
    const body = { batchSize: 10 } as never;
    await controller.processOutbox('1', key, body, user);
    expect(service.processOutbox).toHaveBeenCalledWith({ tenantId: tenantIdFromHeader('1'), body, currentUser: user });
  });

  it('exige el x-idempotency-key antes de tocar el servicio', () => {
    const { controller, service } = build();
    expect(() => controller.processOutbox('1', undefined, {} as never, user)).toThrow();
    expect(service.processOutbox).not.toHaveBeenCalled();
  });

  it('recalculateDataQuality también delega con el input estructurado', async () => {
    const { controller, service } = build();
    const body = { entityType: 'customer' } as never;
    await controller.recalculateDataQuality('1', key, body, user);
    expect(service.recalculateDataQuality).toHaveBeenCalledWith({ tenantId: tenantIdFromHeader('1'), body, currentUser: user });
  });
  /**
   * Hallazgo A-03: estos dos endpoints son NUEVOS, así que usan `@CurrentTenant()` en vez de repetir
   * el parseo manual del header — la deuda que congela `yarn check:tenant-header`. Aquí el tenant
   * llega ya resuelto, y lo que hay que verificar es que la clave de idempotencia se sigue exigiendo.
   */
  describe('jobs de saneamiento', () => {
    it('retryStuckNotifications delega con el tenant ya resuelto por el decorador', async () => {
      const { controller, maintenance } = build();
      const body = { olderThanMinutes: 15, limit: 100, dryRun: false } as never;

      await controller.retryStuckNotifications('1', key, body, user);

      expect(maintenance.retryStuckNotifications).toHaveBeenCalledWith({ tenantId: '1', body, currentUser: user });
    });

    it('purgeIdempotencyKeys delega con el tenant ya resuelto por el decorador', async () => {
      const { controller, maintenance } = build();
      const body = { retentionDays: 30, limit: 1000, dryRun: false } as never;

      await controller.purgeIdempotencyKeys('1', key, body, user);

      expect(maintenance.purgeIdempotencyKeys).toHaveBeenCalledWith({ tenantId: '1', body, currentUser: user });
    });

    it('siguen exigiendo x-idempotency-key', () => {
      const { controller, maintenance } = build();
      const body = { olderThanMinutes: 15, limit: 100, dryRun: false } as never;

      expect(() => controller.retryStuckNotifications('1', undefined, body, user)).toThrow();
      expect(maintenance.retryStuckNotifications).not.toHaveBeenCalled();
    });
  });
});
