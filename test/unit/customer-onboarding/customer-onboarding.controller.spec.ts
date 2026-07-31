import { describe, expect, it, jest } from '@jest/globals';
import { callArg } from '../../support/jest-mocks.js';
import { CustomerOnboardingController } from '../../../src/modules/customer-onboarding/customer-onboarding.controller.js';
import { requireIdempotencyKey, tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';

/**
 * `CustomerOnboardingController`: start público (args posicionales) + 4 pasos autenticados con input
 * estructurado. Todos exigen x-idempotency-key vía requireIdempotencyKey. Spec directo con el servicio
 * mockeado.
 */
describe('CustomerOnboardingController', () => {
  function build() {
    const service = {
      startOnboarding: jest.fn(async () => ({ customerId: '9' })),
      requestContactVerification: jest.fn(async () => ({ sent: true })),
      submitContactVerification: jest.fn(async () => ({ verified: true })),
      submitIdentityPackage: jest.fn(async () => ({ queued: true })),
      submitAddressPackage: jest.fn(async () => ({ ok: true })),
    };
    return { controller: new CustomerOnboardingController(service as never), service };
  }
  const user = { role: 'customer', tenantId: '1', customerId: '9' } as never;
  const req = { ip: '7.7.7.7' } as never;
  const params = { customerId: '9' } as never;

  it('startOnboarding delega con args posicionales (tenant, body, ip, idempotencyKey) y exige la key', async () => {
    const { controller, service } = build();
    const body = { phone: '591700', consents: [] } as never;
    await controller.startOnboarding('1', 'idem', 'mobile_app', body, req);
    expect(service.startOnboarding).toHaveBeenCalledWith(tenantIdFromHeader('1'), body, '7.7.7.7', requireIdempotencyKey('idem'));
    expect(() => controller.startOnboarding('1', undefined, undefined, body, req)).toThrow();
  });

  it('requestContactVerification delega con input estructurado y exige la key', async () => {
    const { controller, service } = build();
    const body = { contactType: 'phone' } as never;
    await controller.requestContactVerification('1', 'idem', params, body, user, req);
    expect(service.requestContactVerification).toHaveBeenCalledWith({
      tenantId: tenantIdFromHeader('1'),
      customerId: '9',
      body,
      currentUser: user,
      ipAddress: '7.7.7.7',
      idempotencyKey: requireIdempotencyKey('idem'),
    });
    expect(() => controller.requestContactVerification('1', undefined, params, body, user, req)).toThrow();
  });

  it('submitIdentityPackage y submitAddressPackage delegan con input estructurado', async () => {
    const { controller, service } = build();
    await controller.submitIdentityPackage('1', 'idem', params, { docs: [] } as never, user, req);
    await controller.submitAddressPackage('1', 'idem', params, { address: {} } as never, user, req);
    expect(callArg<{ customerId: string }>(service.submitIdentityPackage, 0, 0).customerId).toBe('9');
    expect(callArg<{ ipAddress: string }>(service.submitAddressPackage, 0, 0).ipAddress).toBe('7.7.7.7');
  });
});
