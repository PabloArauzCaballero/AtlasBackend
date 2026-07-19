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
    return { controller: new RuntimeJobsController(service as never), service };
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
});
