import { describe, expect, it, jest } from '@jest/globals';
import {
  PaymentsExternalDataController,
  TelcoExternalDataController,
} from '../../../src/modules/external-data/controllers/payments-telco.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';
import { actorId } from '../../../src/modules/external-data/external-data-controller.util.js';

/**
 * Verticales de pagos (QR / transferencia) y telco (confianza del número). Todos verifican el acceso
 * del cliente y delegan en `ExternalDataService`. Spec directo con el servicio mockeado.
 */
describe('Payments/Telco external-data controllers', () => {
  const user = { role: 'risk_analyst', tenantId: '1', internalUserId: 'u1' } as never;
  const expectedCall = (body: unknown, customerId = '9') => ({
    tenantId: tenantIdFromHeader('1', user),
    customerId,
    body,
    idempotencyKey: 'idem',
    requestedByUserId: actorId(user),
  });

  it('verifyQr y verifyBankTransfer delegan en sus métodos del servicio', async () => {
    const service = { executeQrPayment: jest.fn(async () => ({})), executeBankTransfer: jest.fn(async () => ({})) };
    const controller = new PaymentsExternalDataController(service as never);
    const qrBody = { customerId: '9', reference: 'r1' } as never;
    const btBody = { customerId: '9', amount: 100 } as never;
    await controller.verifyQr('1', 'idem', qrBody, user);
    await controller.verifyBankTransfer('1', 'idem', btBody, user);
    expect(service.executeQrPayment).toHaveBeenCalledWith(expectedCall(qrBody));
    expect(service.executeBankTransfer).toHaveBeenCalledWith(expectedCall(btBody));
  });

  it('verifyPhoneTrust delega en executeTelcoPhoneTrust', async () => {
    const service = { executeTelcoPhoneTrust: jest.fn(async () => ({})) };
    const controller = new TelcoExternalDataController(service as never);
    const body = { customerId: '9', phone: '591700' } as never;
    await controller.verifyPhoneTrust('1', 'idem', body, user);
    expect(service.executeTelcoPhoneTrust).toHaveBeenCalledWith(expectedCall(body));
  });

  it('getPhoneTrust delega en getCustomerFeatures con tenant+customerId del param', async () => {
    const service = { getCustomerFeatures: jest.fn(async () => ({ features: {} })) };
    const controller = new TelcoExternalDataController(service as never);
    await controller.getPhoneTrust('1', { customerId: '9' } as never, user);
    expect(service.getCustomerFeatures).toHaveBeenCalledWith({ tenantId: tenantIdFromHeader('1', user), customerId: '9' });
  });

  it('bloquea a un customer que consulta a otro cliente', () => {
    const service = { executeQrPayment: jest.fn() };
    const controller = new PaymentsExternalDataController(service as never);
    const customer = { role: 'customer', tenantId: '1', customerId: '9' } as never;
    expect(() => controller.verifyQr('1', 'idem', { customerId: '99' } as never, customer)).toThrow();
    expect(service.executeQrPayment).not.toHaveBeenCalled();
  });
});
