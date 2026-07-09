import { describe, expect, it, jest } from '@jest/globals';
import { CustomerOnboardingService } from '../../../src/modules/customer-onboarding/customer-onboarding.service.js';

/**
 * ATLAS-P12d (extensión — `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, punto 5):
 * `CustomerOnboardingService` es una fachada pura de delegación (igual patrón que
 * `SessionsRepository`/`CustomerOnboardingRepository` de `ATLAS-P11-T12`). El único riesgo real
 * es cablear un método al servicio equivocado — este test lo verifica explícitamente.
 */
describe('CustomerOnboardingService (facade)', () => {
  function buildService() {
    const startService = { startOnboarding: jest.fn() };
    const contactVerificationService = { requestContactVerification: jest.fn(), submitContactVerification: jest.fn() };
    const identityPackageService = { submitIdentityPackage: jest.fn() };
    const addressPackageService = { submitAddressPackage: jest.fn() };
    const service = new CustomerOnboardingService(
      startService as never,
      contactVerificationService as never,
      identityPackageService as never,
      addressPackageService as never,
    );
    return { service, startService, contactVerificationService, identityPackageService, addressPackageService };
  }

  it('delegates startOnboarding to CustomerOnboardingStartService with the exact arguments', async () => {
    const { service, startService } = buildService();
    await service.startOnboarding('t1', {} as never, '10.0.0.1', 'idem-1');
    expect(startService.startOnboarding).toHaveBeenCalledWith('t1', {}, '10.0.0.1', 'idem-1');
  });

  it('delegates requestContactVerification to CustomerContactVerificationService, not to submitContactVerification', async () => {
    const { service, contactVerificationService } = buildService();
    const input = {
      tenantId: 't1',
      customerId: 'c1',
      body: {} as never,
      currentUser: {} as never,
      ipAddress: null,
      idempotencyKey: 'idem-1',
    };
    await service.requestContactVerification(input);
    expect(contactVerificationService.requestContactVerification).toHaveBeenCalledWith(input);
    expect(contactVerificationService.submitContactVerification).not.toHaveBeenCalled();
  });

  it('delegates submitIdentityPackage to CustomerIdentityPackageService, not to the address package service', async () => {
    const { service, identityPackageService, addressPackageService } = buildService();
    const input = {
      tenantId: 't1',
      customerId: 'c1',
      body: {} as never,
      currentUser: {} as never,
      ipAddress: null,
      idempotencyKey: 'idem-1',
    };
    await service.submitIdentityPackage(input);
    expect(identityPackageService.submitIdentityPackage).toHaveBeenCalledWith(input);
    expect(addressPackageService.submitAddressPackage).not.toHaveBeenCalled();
  });

  it('delegates submitAddressPackage to CustomerAddressPackageService', async () => {
    const { service, addressPackageService } = buildService();
    const input = {
      tenantId: 't1',
      customerId: 'c1',
      body: {} as never,
      currentUser: {} as never,
      ipAddress: null,
      idempotencyKey: 'idem-1',
    };
    await service.submitAddressPackage(input);
    expect(addressPackageService.submitAddressPackage).toHaveBeenCalledWith(input);
  });

  it('propagates the return value from the delegated call unchanged', async () => {
    const { service, startService } = buildService();
    (startService.startOnboarding as jest.Mock).mockResolvedValueOnce({ customerId: 'c1' } as never);
    const result = await service.startOnboarding('t1', {} as never, null, 'idem-1');
    expect(result).toEqual({ customerId: 'c1' });
  });
});
