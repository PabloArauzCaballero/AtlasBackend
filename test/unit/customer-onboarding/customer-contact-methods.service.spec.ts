import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { CustomerContactMethodsService } from '../../../src/modules/customer-onboarding/application/customer-contact-methods.service.js';

/**
 * Cambiar el correo cuando ya hay un contacto verificado.
 *
 * La corrección de un contacto mal escrito tiene dos pasos —declarar el valor nuevo y confirmarlo
 * con el código que llega a él— y entre los dos la app se puede cerrar. Estos tests fijan que volver
 * a declarar el MISMO valor retoma la corrección en vez de responder «ya está en otra cuenta», y que
 * «ya lo tienes verificado» y «es de otra cuenta» llegan a la app como respuestas distintas.
 */
describe('CustomerContactMethodsService', () => {
  function buildService(options: { lifecycleStatus?: string; existing?: Record<string, unknown> | null } = {}) {
    const customersRepository = {
      findById: jest.fn(async (..._args: unknown[]) => ({ id: 'c1', lifecycleStatus: options.lifecycleStatus ?? 'active' })),
    };
    const profileDataRepository = {
      findContactMethodByHash: jest.fn(async (..._args: unknown[]) => options.existing ?? null),
      createContactMethod: jest.fn(),
    };
    const onboardingRepository = { createOperationalAuditLog: jest.fn() };
    const eligibilityService = { evaluate: jest.fn(async (..._args: unknown[]) => ({ nextStep: 'none' })) };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };

    const service = new CustomerContactMethodsService(
      customersRepository as never,
      profileDataRepository as never,
      onboardingRepository as never,
      eligibilityService as never,
      sequelize as never,
    );
    return { service, profileDataRepository, onboardingRepository };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;
  const input = {
    tenantId: 't1',
    customerId: 'c1',
    body: { contactType: 'email', value: 'correcto@ejemplo.bo' } as never,
    currentUser: customerUser,
    ipAddress: '10.0.0.1',
  };

  it('el mismo correo sin verificar devuelve el contacto existente para retomar, sin crear otra fila ni otra auditoría', async () => {
    const { service, profileDataRepository, onboardingRepository } = buildService({
      existing: { id: 77, contactType: 'email', status: 'unverified', valueLast4: null, emailDomain: 'ejemplo.bo' },
    });

    const result = await service.addContactMethod(input);

    expect(result).toEqual(
      expect.objectContaining({ contactMethodId: '77', contactType: 'email', status: 'unverified', emailDomain: 'ejemplo.bo' }),
    );
    expect(profileDataRepository.createContactMethod).not.toHaveBeenCalled();
    expect(onboardingRepository.createOperationalAuditLog).not.toHaveBeenCalled();
  });

  it('un contacto que el cliente ya verificó responde CONTACT_ALREADY_VERIFIED, no «está en otra cuenta»', async () => {
    const { service, profileDataRepository } = buildService({ existing: { id: 5, contactType: 'email', status: 'verified' } });

    await expect(service.addContactMethod(input)).rejects.toThrow(new ConflictException('CONTACT_ALREADY_VERIFIED'));
    expect(profileDataRepository.createContactMethod).not.toHaveBeenCalled();
  });

  it('un cliente ACTIVO con su contacto ya verificado puede declarar un correo nuevo: busca duplicados y no se bloquea por estado', async () => {
    const { service, profileDataRepository } = buildService({
      lifecycleStatus: 'active',
      existing: { id: 8, contactType: 'email', status: 'unverified' },
    });

    await expect(service.addContactMethod(input)).resolves.toEqual(expect.objectContaining({ contactMethodId: '8' }));
    expect(profileDataRepository.findContactMethodByHash).toHaveBeenCalledTimes(1);
  });

  it('un cliente bloqueado no puede cambiar contactos: el problema no es el dato de contacto', async () => {
    const { service, profileDataRepository } = buildService({ lifecycleStatus: 'blocked' });

    await expect(service.addContactMethod(input)).rejects.toThrow(UnprocessableEntityException);
    expect(profileDataRepository.findContactMethodByHash).not.toHaveBeenCalled();
  });

  it('nunca opera sobre el cliente de otra persona', async () => {
    const { service, profileDataRepository } = buildService();
    const otherCustomer = { role: 'customer', customerId: 'c2', internalUserId: null, platformUserId: null } as never;

    await expect(service.addContactMethod({ ...input, currentUser: otherCustomer })).rejects.toThrow();
    expect(profileDataRepository.findContactMethodByHash).not.toHaveBeenCalled();
  });
});
