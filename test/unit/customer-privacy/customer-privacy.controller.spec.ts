import { describe, expect, it, jest } from '@jest/globals';
import { callArg } from '../../support/jest-mocks.js';
import { CustomerPrivacyController } from '../../../src/modules/customer-privacy/customer-privacy.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';

/**
 * `CustomerPrivacyController` registra decisiones de consentimiento y solicitudes ARCO/GDPR. Ramas
 * propias: exigencia de x-idempotency-key, IP desde el request y el canal por defecto (mobile_app).
 * Spec directo con el servicio mockeado.
 */
describe('CustomerPrivacyController', () => {
  function build() {
    const service = {
      registerConsentDecisions: jest.fn(async () => ({ processed: 1 })),
      createDataSubjectRequest: jest.fn(async () => ({ id: 'r1' })),
    };
    return { controller: new CustomerPrivacyController(service as never), service };
  }
  const params = { customerId: '9' } as never;
  const user = { role: 'customer', tenantId: '1', customerId: '9' } as never;
  const req = { ip: '9.9.9.9' } as never;

  it('registerConsentDecisions delega con IP y canal por defecto mobile_app', async () => {
    const { controller, service } = build();
    const body = { decisions: [] } as never;
    await controller.registerConsentDecisions('1', 'idem', undefined, params, body, user, req);
    expect(service.registerConsentDecisions).toHaveBeenCalledWith({
      tenantId: tenantIdFromHeader('1'),
      customerId: '9',
      body,
      currentUser: user,
      idempotencyKey: 'idem',
      ipAddress: '9.9.9.9',
      channel: 'mobile_app',
    });
  });

  it('registerConsentDecisions respeta el x-client-channel explícito', async () => {
    const { controller, service } = build();
    await controller.registerConsentDecisions('1', 'idem', 'web_portal', params, { decisions: [] } as never, user, req);
    expect(callArg<{ channel: string }>(service.registerConsentDecisions, 0, 0).channel).toBe('web_portal');
  });

  it('registerConsentDecisions exige el x-idempotency-key', () => {
    const { controller, service } = build();
    expect(() => controller.registerConsentDecisions('1', undefined, undefined, params, {} as never, user, req)).toThrow();
    expect(service.registerConsentDecisions).not.toHaveBeenCalled();
  });

  it('createDataSubjectRequest delega y toma la IP del request (null si falta)', async () => {
    const { controller, service } = build();
    await controller.createDataSubjectRequest('1', 'idem', params, { type: 'ACCESS' } as never, user, {} as never);
    expect(service.createDataSubjectRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: tenantIdFromHeader('1'), customerId: '9', idempotencyKey: 'idem', ipAddress: null }),
    );
  });

  it('createDataSubjectRequest exige el x-idempotency-key', () => {
    const { controller, service } = build();
    expect(() => controller.createDataSubjectRequest('1', undefined, params, {} as never, user, req)).toThrow();
    expect(service.createDataSubjectRequest).not.toHaveBeenCalled();
  });
});
