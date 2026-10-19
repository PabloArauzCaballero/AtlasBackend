import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { CustomerOnboardingService } from '../../../src/modules/customer-onboarding/customer-onboarding.service.js';

/**
 * ATLAS-P12d (extensión — `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, punto 5):
 * `CustomerOnboardingService` es una fachada pura de delegación (igual patrón que
 * `SessionsRepository`/`CustomerOnboardingRepository` de `ATLAS-P11-T12`). El único riesgo real
 * es cablear un método al servicio equivocado — este test lo verifica explícitamente.
 */
describe('CustomerOnboardingService (facade)', () => {
  function buildService() {
    // El doble devuelve una respuesta de verdad —no `undefined`— porque la fachada la usa: de ella
    // saca el cliente y la sesión con los que abre el expediente.
    const respuesta = { customerId: 'c1', sessionId: 's1', customerCode: 'CLI-1' };
    const startService = { startOnboarding: jest.fn(async (..._args: unknown[]) => respuesta) };
    const contactVerificationService = { requestContactVerification: jest.fn(), submitContactVerification: jest.fn() };
    const identityPackageService = { submitIdentityPackage: jest.fn() };
    const addressPackageService = { submitAddressPackage: jest.fn() };
    // El expediente se abre después del alta y no cambia lo que ésta devuelve; aquí basta con que
    // no haga nada, que es justo lo que estas pruebas de delegación necesitan comprobar.
    const expedienteHooks = { alIniciarOnboarding: jest.fn() };
    const ipBlock = { isDeviceBlocked: jest.fn(async (..._a: unknown[]) => false) };
    const documentDuplicates = { assertNotRegisteredToAnotherCustomer: jest.fn(async (..._a: unknown[]) => undefined) };
    const service = new CustomerOnboardingService(
      startService as never,
      contactVerificationService as never,
      identityPackageService as never,
      addressPackageService as never,
      expedienteHooks as never,
      documentDuplicates as never,
      ipBlock as never,
    );
    return {
      service,
      ipBlock,
      documentDuplicates,
      startService,
      contactVerificationService,
      identityPackageService,
      addressPackageService,
      expedienteHooks,
      respuesta,
    };
  }

  it('delegates startOnboarding to CustomerOnboardingStartService with the exact arguments', async () => {
    const { service, startService } = buildService();
    await service.startOnboarding('t1', { device: { deviceFingerprintHash: 'h' } } as never, '10.0.0.1', 'idem-1');
    expect(startService.startOnboarding).toHaveBeenCalledWith('t1', { device: { deviceFingerprintHash: 'h' } }, '10.0.0.1', 'idem-1');
  });

  it('abre el expediente del cliente DESPUÉS del alta, con la sesión por la que entró', async () => {
    // Sin esto, la carpeta del cliente sólo existiría si alguien lanzara el relleno a mano, y un
    // caso en revisión humana aparecería vacío — indistinguible de un cliente que no subió nada.
    const { service, expedienteHooks } = buildService();
    await service.startOnboarding('t1', { device: { deviceFingerprintHash: 'h' } } as never, '10.0.0.1', 'idem-1');
    expect(expedienteHooks.alIniciarOnboarding).toHaveBeenCalledWith({
      tenantId: 't1',
      customerId: 'c1',
      sessionId: 's1',
      customerCode: 'CLI-1',
    });
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

  const startInput = { device: { deviceFingerprintHash: 'f'.repeat(64) } } as never;

  it('un teléfono bloqueado no abre otra cuenta aunque haya cambiado de IP', async () => {
    const { service, startService, ipBlock } = buildService();
    ipBlock.isDeviceBlocked.mockResolvedValueOnce(true);
    await expect(service.startOnboarding('t1', startInput, '200.9.9.9', 'idem-1')).rejects.toThrow('ONBOARDING_IP_BLOCKED');
    expect(ipBlock.isDeviceBlocked).toHaveBeenCalledWith('f'.repeat(64));
    expect(startService.startOnboarding).not.toHaveBeenCalled();
  });

  const identityInput = {
    tenantId: 't1',
    customerId: 'c1',
    body: { identity: { documentNumber: '8452136', documentNumberHash: 'h1' } } as never,
    currentUser: { role: 'customer', customerId: 'c1' } as never,
    ipAddress: '10.0.0.1',
    idempotencyKey: 'idem-1',
  };

  it('delegates submitIdentityPackage to CustomerIdentityPackageService, not to the address package service', async () => {
    const { service, identityPackageService, addressPackageService } = buildService();
    await service.submitIdentityPackage(identityInput);
    expect(identityPackageService.submitIdentityPackage).toHaveBeenCalledWith(identityInput);
    expect(addressPackageService.submitAddressPackage).not.toHaveBeenCalled();
  });

  it('contrasta el carnet con las demás cuentas ANTES de guardar el paquete', async () => {
    const { service, identityPackageService, documentDuplicates } = buildService();
    await service.submitIdentityPackage(identityInput);
    expect(documentDuplicates.assertNotRegisteredToAnotherCustomer).toHaveBeenCalledWith({
      tenantId: 't1',
      customerId: 'c1',
      documentNumber: '8452136',
      documentNumberHash: 'h1',
      ipAddress: '10.0.0.1',
      blockCaller: true,
    });
    const duplicateOrder = documentDuplicates.assertNotRegisteredToAnotherCustomer.mock.invocationCallOrder[0] as number;
    const saveOrder = identityPackageService.submitIdentityPackage.mock.invocationCallOrder[0] as number;
    expect(duplicateOrder).toBeLessThan(saveOrder);
  });

  it('si el carnet es de otra cuenta, el paquete no se guarda', async () => {
    const { service, identityPackageService, documentDuplicates } = buildService();
    documentDuplicates.assertNotRegisteredToAnotherCustomer.mockRejectedValueOnce(new ForbiddenException('ONBOARDING_IP_BLOCKED') as never);
    await expect(service.submitIdentityPackage(identityInput)).rejects.toThrow('ONBOARDING_IP_BLOCKED');
    expect(identityPackageService.submitIdentityPackage).not.toHaveBeenCalled();
  });

  it('personal interno que envía por un cliente no bloquea la IP ni la cuenta del cliente', async () => {
    const { service, documentDuplicates } = buildService();
    await service.submitIdentityPackage({ ...identityInput, currentUser: { role: 'internal_operator', customerId: null } as never });
    expect(documentDuplicates.assertNotRegisteredToAnotherCustomer).toHaveBeenCalledWith(expect.objectContaining({ blockCaller: false }));
  });

  it('un token de otro cliente no llega ni a comparar el carnet', async () => {
    const { service, documentDuplicates } = buildService();
    const ajeno = { ...identityInput, currentUser: { role: 'customer', customerId: 'otro' } as never };
    await expect(service.submitIdentityPackage(ajeno)).rejects.toThrow(ForbiddenException);
    expect(documentDuplicates.assertNotRegisteredToAnotherCustomer).not.toHaveBeenCalled();
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
    const result = await service.startOnboarding('t1', { device: { deviceFingerprintHash: 'h' } } as never, null, 'idem-1');
    expect(result).toEqual({ customerId: 'c1' });
  });
});
