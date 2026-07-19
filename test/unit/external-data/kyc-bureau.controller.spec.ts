import { describe, expect, it, jest } from '@jest/globals';
import {
  BureauExternalDataController,
  KycExternalDataController,
} from '../../../src/modules/external-data/controllers/kyc-bureau.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';
import { actorId } from '../../../src/modules/external-data/external-data-controller.util.js';

/**
 * Controllers de los verticales KYC (SEGIP) y buró (InfoCenter). Ambos verifican el acceso del cliente
 * (`assertCustomerAccess`) antes de delegar en `ExternalDataService` con tenant/customerId/actor. Spec
 * directo con el servicio mockeado; los utils de tenant/actor/ownership corren de verdad.
 */
describe('KYC/Bureau external-data controllers', () => {
  const internalUser = { role: 'risk_analyst', tenantId: '1', internalUserId: 'u1' } as never;

  it('verifySegip delega en executeSegip con tenant/customerId/actor', async () => {
    const service = { executeSegip: jest.fn(async () => ({ ok: true })) };
    const controller = new KycExternalDataController(service as never);
    const body = { customerId: '9', documentNumber: 'X' } as never;
    await controller.verifySegip('1', 'idem', body, internalUser);
    expect(service.executeSegip).toHaveBeenCalledWith({
      tenantId: tenantIdFromHeader('1', internalUser),
      customerId: '9',
      body,
      idempotencyKey: 'idem',
      requestedByUserId: actorId(internalUser),
    });
  });

  it('verifySegip bloquea a un customer que consulta la identidad de otro cliente', () => {
    const service = { executeSegip: jest.fn() };
    const controller = new KycExternalDataController(service as never);
    const customer = { role: 'customer', tenantId: '1', customerId: '9' } as never;
    expect(() => controller.verifySegip('1', 'idem', { customerId: '99' } as never, customer)).toThrow();
    expect(service.executeSegip).not.toHaveBeenCalled();
  });

  it('checkInfocenter delega en executeInfocenter con tenant/customerId/actor', async () => {
    const service = { executeInfocenter: jest.fn(async () => ({ ok: true })) };
    const controller = new BureauExternalDataController(service as never);
    const body = { customerId: '9' } as never;
    await controller.checkInfocenter('1', 'idem', body, internalUser);
    expect(service.executeInfocenter).toHaveBeenCalledWith({
      tenantId: tenantIdFromHeader('1', internalUser),
      customerId: '9',
      body,
      idempotencyKey: 'idem',
      requestedByUserId: actorId(internalUser),
    });
  });
});
