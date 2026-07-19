import { describe, expect, it, jest } from '@jest/globals';
import {
  DigitalTrustExternalDataController,
  FacebookExternalDataController,
  WhatsappExternalDataController,
} from '../../../src/modules/external-data/controllers/social-trust.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';
import { actorId } from '../../../src/modules/external-data/external-data-controller.util.js';

/**
 * Verticales de señales sociales y confianza digital (Facebook / WhatsApp / digital-trust). Todos
 * verifican el acceso del cliente y delegan en `ExternalDataService`. Spec directo con el servicio
 * mockeado; se cubre un representativo por controller + la rama forbidden.
 */
describe('Social/Digital-trust external-data controllers', () => {
  const user = { role: 'risk_analyst', tenantId: '1', internalUserId: 'u1' } as never;
  const providerCall = (body: unknown) => ({
    tenantId: tenantIdFromHeader('1', user),
    customerId: '9',
    body,
    idempotencyKey: 'idem',
    requestedByUserId: actorId(user),
  });
  const featuresCall = { tenantId: tenantIdFromHeader('1', user), customerId: '9' };

  function service() {
    return {
      createFacebookConnectUrl: jest.fn(async () => ({ url: 'https://fb' })),
      executeFacebookCallback: jest.fn(async () => ({})),
      executeWhatsapp: jest.fn(async () => ({})),
      executeDigitalTrust: jest.fn(async () => ({})),
      getCustomerFeatures: jest.fn(async () => ({ features: {} })),
    };
  }

  it('Facebook: connect-url, callback y status delegan correctamente', async () => {
    const svc = service();
    const controller = new FacebookExternalDataController(svc as never);
    await controller.getConnectUrl('1', { customerId: '9' } as never, user);
    expect(svc.createFacebookConnectUrl).toHaveBeenCalledWith(featuresCall);
    const cbBody = { customerId: '9', code: 'oauth' } as never;
    await controller.callback('1', 'idem', cbBody, user);
    expect(svc.executeFacebookCallback).toHaveBeenCalledWith(providerCall(cbBody));
    await controller.status('1', { customerId: '9' } as never, user);
    expect(svc.getCustomerFeatures).toHaveBeenCalledWith(featuresCall);
  });

  it('WhatsApp: start y confirm delegan en executeWhatsapp', async () => {
    const svc = service();
    const controller = new WhatsappExternalDataController(svc as never);
    const startBody = { customerId: '9', phone: '591700' } as never;
    const confirmBody = { customerId: '9', code: '123' } as never;
    await controller.start('1', 'idem', startBody, user);
    await controller.confirm('1', 'idem', confirmBody, user);
    expect(svc.executeWhatsapp).toHaveBeenNthCalledWith(1, providerCall(startBody));
    expect(svc.executeWhatsapp).toHaveBeenNthCalledWith(2, providerCall(confirmBody));
  });

  it('DigitalTrust: check delega en executeDigitalTrust y profile en getCustomerFeatures', async () => {
    const svc = service();
    const controller = new DigitalTrustExternalDataController(svc as never);
    const body = { customerId: '9', email: 'a@x.com' } as never;
    await controller.check('1', 'idem', body, user);
    expect(svc.executeDigitalTrust).toHaveBeenCalledWith(providerCall(body));
    await controller.profile('1', { customerId: '9' } as never, user);
    expect(svc.getCustomerFeatures).toHaveBeenCalledWith(featuresCall);
  });

  it('bloquea a un customer que consulta a otro cliente', () => {
    const svc = service();
    const controller = new DigitalTrustExternalDataController(svc as never);
    const customer = { role: 'customer', tenantId: '1', customerId: '9' } as never;
    expect(() => controller.check('1', 'idem', { customerId: '99' } as never, customer)).toThrow();
    expect(svc.executeDigitalTrust).not.toHaveBeenCalled();
  });
});
