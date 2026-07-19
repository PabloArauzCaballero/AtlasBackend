import { describe, expect, it, jest } from '@jest/globals';
import { AuditController } from '../../../src/modules/audit/audit.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';

/**
 * `AuditController` parsea el `x-tenant-id` del header y delega en `AuditService`. Spec directo con el
 * servicio mockeado: verifica el wiring de tenant/params/query en las dos rutas (offset y feed).
 */
describe('AuditController', () => {
  function build() {
    const service = {
      getCustomerAudit: jest.fn(async () => ({ events: [], meta: {} })),
      getCustomerAuditFeed: jest.fn(async () => ({ events: [], nextCursor: null })),
    };
    return { controller: new AuditController(service as never), service };
  }

  it('getCustomerAudit delega con el tenant parseado, params y query', async () => {
    const { controller, service } = build();
    const params = { customerId: '9' } as never;
    const query = { page: 1, limit: 10 } as never;
    await controller.getCustomerAudit('1', params, query);
    expect(service.getCustomerAudit).toHaveBeenCalledWith(tenantIdFromHeader('1'), params, query);
  });

  it('getCustomerAuditFeed delega con tenant, customerId y query', async () => {
    const { controller, service } = build();
    await controller.getCustomerAuditFeed('1', { customerId: '9' } as never, { limit: 10 } as never);
    expect(service.getCustomerAuditFeed).toHaveBeenCalledWith(tenantIdFromHeader('1'), '9', { limit: 10 });
  });
});
