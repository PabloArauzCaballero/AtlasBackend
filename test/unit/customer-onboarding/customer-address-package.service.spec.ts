import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerAddressPackageService } from '../../../src/modules/customer-onboarding/application/customer-address-package.service.js';

/**
 * ATLAS-P12d (extensión — `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, punto 5): último
 * servicio de aplicación de `customer-onboarding` sin cubrir. Con este archivo, los 5 servicios
 * de aplicación del módulo (`start`, `contact-verification`, `identity-package`,
 * `address-package`, y la fachada) quedan completamente cubiertos. El caso más importante es la
 * creación vs. versionado de dirección: cada envío crea una nueva *versión* de dirección
 * (append-only, preservando el historial), nunca sobrescribe la anterior.
 */
describe('CustomerAddressPackageService.submitAddressPackage', () => {
  function buildService() {
    const customersRepository = { findById: jest.fn() };
    const onboardingRepository = {
      findCurrentAddress: jest.fn(),
      createAddress: jest.fn(),
      touchAddress: jest.fn(),
      createAddressVersion: jest.fn(),
      updateAddressCurrentVersion: jest.fn(),
      createGpsObservation: jest.fn(),
      createCustomerObservation: jest.fn(),
      findLatestOnboardingFlow: jest.fn(),
      createOnboardingStepEvent: jest.fn(),
      createCustomerActionLog: jest.fn(),
      createOperationalAuditLog: jest.fn(),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const service = new CustomerAddressPackageService(customersRepository as never, onboardingRepository as never, sequelize as never);
    return { service, customersRepository, onboardingRepository };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;

  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: 't1',
      customerId: 'c1',
      body: { address: { city: 'Santa Cruz', department: 'Santa Cruz', countryCode: 'BO' } } as never,
      currentUser: customerUser,
      ipAddress: '10.0.0.1',
      idempotencyKey: 'idem-1',
      ...overrides,
    };
  }

  it('throws BadRequestException without an idempotency key', async () => {
    const { service } = buildService();
    await expect(service.submitAddressPackage(baseInput({ idempotencyKey: '' }))).rejects.toThrow(BadRequestException);
  });

  it('throws ForbiddenException when a customer token submits for a different customerId', async () => {
    const { service } = buildService();
    await expect(service.submitAddressPackage(baseInput({ customerId: 'someone-else' }))).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when the customer does not exist', async () => {
    const { service, customersRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(service.submitAddressPackage(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('creates a new "home" address on the very first submission', async () => {
    const { service, customersRepository, onboardingRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (onboardingRepository.findCurrentAddress as jest.Mock).mockResolvedValueOnce(null as never);
    (onboardingRepository.createAddress as jest.Mock).mockResolvedValueOnce({ id: 'address-1' } as never);
    (onboardingRepository.createAddressVersion as jest.Mock).mockResolvedValueOnce({ id: 'version-1' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.submitAddressPackage(baseInput());

    expect(onboardingRepository.createAddress).toHaveBeenCalledTimes(1);
    const addressArgs = (onboardingRepository.createAddress as jest.Mock).mock.calls[0][0] as { addressType: string };
    expect(addressArgs.addressType).toBe('home');
  });

  it('reuses (touches) the existing address record on a subsequent submission, instead of creating a second one', async () => {
    const { service, customersRepository, onboardingRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (onboardingRepository.findCurrentAddress as jest.Mock).mockResolvedValueOnce({ id: 'existing-address' } as never);
    (onboardingRepository.createAddressVersion as jest.Mock).mockResolvedValueOnce({ id: 'version-2' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.submitAddressPackage(baseInput());

    expect(onboardingRepository.createAddress).not.toHaveBeenCalled();
    expect(onboardingRepository.touchAddress).toHaveBeenCalledTimes(1);
  });

  it('always creates a NEW address version, even when the address record itself is reused — preserves history, never overwrites', async () => {
    const { service, customersRepository, onboardingRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (onboardingRepository.findCurrentAddress as jest.Mock).mockResolvedValueOnce({ id: 'existing-address' } as never);
    (onboardingRepository.createAddressVersion as jest.Mock).mockResolvedValueOnce({ id: 'version-2' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.submitAddressPackage(baseInput());

    expect(onboardingRepository.createAddressVersion).toHaveBeenCalledTimes(1);
    expect(onboardingRepository.updateAddressCurrentVersion).toHaveBeenCalledWith(
      { id: 'existing-address' },
      'version-2',
      expect.any(Date),
      { transaction: {} },
    );
  });

  it('does not create any GPS observation when the caller does not provide one', async () => {
    const { service, customersRepository, onboardingRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (onboardingRepository.findCurrentAddress as jest.Mock).mockResolvedValueOnce({ id: 'address-1' } as never);
    (onboardingRepository.createAddressVersion as jest.Mock).mockResolvedValueOnce({ id: 'version-1' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.submitAddressPackage(baseInput());

    expect(onboardingRepository.createGpsObservation).not.toHaveBeenCalled();
  });

  it('creates a GPS observation AND a customer observation when a gpsObservation is provided, rounding lat/lng correctly', async () => {
    const { service, customersRepository, onboardingRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (onboardingRepository.findCurrentAddress as jest.Mock).mockResolvedValueOnce({ id: 'address-1' } as never);
    (onboardingRepository.createAddressVersion as jest.Mock).mockResolvedValueOnce({ id: 'version-1' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.submitAddressPackage(
      baseInput({
        body: {
          address: { city: 'Santa Cruz', department: 'Santa Cruz', countryCode: 'BO' },
          gpsObservation: { lat: -17.783333333, lng: -63.182222222 },
        },
      }),
    );

    expect(onboardingRepository.createGpsObservation).toHaveBeenCalledTimes(1);
    expect(onboardingRepository.createCustomerObservation).toHaveBeenCalledTimes(1);
    const gpsArgs = (onboardingRepository.createGpsObservation as jest.Mock).mock.calls[0][0] as { gpsLat: string; gpsLng: string };
    expect(gpsArgs.gpsLat).toBe('-17.7833333');
    expect(gpsArgs.gpsLng).toBe('-63.1822222');
  });

  it('normalizedAddressText is derived (hashed) from the encrypted address line only when one is provided', async () => {
    const { service, customersRepository, onboardingRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (onboardingRepository.findCurrentAddress as jest.Mock).mockResolvedValueOnce({ id: 'address-1' } as never);
    (onboardingRepository.createAddressVersion as jest.Mock).mockResolvedValueOnce({ id: 'version-1' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.submitAddressPackage(baseInput());

    const versionArgs = (onboardingRepository.createAddressVersion as jest.Mock).mock.calls[0][0] as {
      declaredAddressText: unknown;
      normalizedAddressText: unknown;
    };
    expect(versionArgs.declaredAddressText).toBeNull();
    expect(versionArgs.normalizedAddressText).toBeNull();
  });

  it('returns nextStep "risk_evaluation" — the same next step as the identity package, both feed the same downstream decision', async () => {
    const { service, customersRepository, onboardingRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (onboardingRepository.findCurrentAddress as jest.Mock).mockResolvedValueOnce({ id: 'address-1' } as never);
    (onboardingRepository.createAddressVersion as jest.Mock).mockResolvedValueOnce({ id: 'version-1' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    const result = await service.submitAddressPackage(baseInput());

    expect(result).toMatchObject({
      addressId: 'address-1',
      addressVersionId: 'version-1',
      status: 'recorded',
      nextStep: 'risk_evaluation',
    });
  });
});
