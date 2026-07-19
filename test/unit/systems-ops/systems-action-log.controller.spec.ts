import { describe, expect, it, jest } from '@jest/globals';
import { SystemsActionLogController } from '../../../src/modules/systems-ops/systems-action-log.controller.js';

/**
 * `SystemsActionLogController` delega en `SystemsActionLogQueryService` pasando el `user` (para el
 * scope de tenant) y, en los reportes, `query.windowHours`. Spec directo con el servicio mockeado.
 */
describe('SystemsActionLogController', () => {
  function build() {
    const service = {
      listActionLogs: jest.fn(async () => ({ items: [] })),
      getActionLogsByRequest: jest.fn(async () => ({ items: [] })),
      getTrafficLatencyReport: jest.fn(async () => ({ routes: [] })),
      getTrafficLatencyTimeseries: jest.fn(async () => ({ buckets: [] })),
    };
    return { controller: new SystemsActionLogController(service as never), service };
  }
  const user = { role: 'system_admin', tenantId: '1' } as never;

  it('listActionLogs delega con query y user', async () => {
    const { controller, service } = build();
    await controller.listActionLogs({ method: 'GET' } as never, user);
    expect(service.listActionLogs).toHaveBeenCalledWith({ method: 'GET' }, user);
  });

  it('ambos alias de by-request delegan en getActionLogsByRequest', async () => {
    const { controller, service } = build();
    await controller.getActionLogsByRequestAlias({ requestId: 'r1' } as never, user);
    await controller.getActionLogsByRequest({ requestId: 'r2' } as never, user);
    expect(service.getActionLogsByRequest).toHaveBeenNthCalledWith(1, 'r1', user);
    expect(service.getActionLogsByRequest).toHaveBeenNthCalledWith(2, 'r2', user);
  });

  it('los reportes de tráfico pasan windowHours y user', async () => {
    const { controller, service } = build();
    await controller.getTrafficLatencyReport({ windowHours: 24 } as never, user);
    await controller.getTrafficLatencyTimeseries({ windowHours: 6 } as never, user);
    expect(service.getTrafficLatencyReport).toHaveBeenCalledWith(24, user);
    expect(service.getTrafficLatencyTimeseries).toHaveBeenCalledWith(6, user);
  });
});
