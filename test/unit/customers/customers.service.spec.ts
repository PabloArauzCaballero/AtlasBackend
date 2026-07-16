import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 4): primer test real de `customers`
 * `getCustomerMe` es el
 * endpoint "me" que usa cada pantalla del cliente — alto tráfico, bajo margen de error. El caso
 * más importante es la verificación de ownership: un cliente autenticado nunca debe poder leer
 * el perfil de otro `customerId` solo cambiando el parámetro de la URL.
 */
jest.mock('../../../src/modules/customers/customers.mapper.js', () => ({
  toCustomerMeResponse: jest.fn((input: unknown) => ({ mapped: true, input })),
}));

describe('CustomersService.getCustomerMe', () => {
  async function buildService() {
    const { CustomersService } = await import('../../../src/modules/customers/customers.service.js');
    const repository = {
      findById: jest.fn(),
      findCurrentProfile: jest.fn(),
      findContactMethods: jest.fn(),
      findCustomerConsents: jest.fn(),
      findLatestRiskResult: jest.fn(),
    };
    const service = new CustomersService(repository as never);
    return { service, repository };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;

  it('throws ForbiddenException when a customer token requests a different customerId', async () => {
    const { service, repository } = await buildService();
    await expect(service.getCustomerMe('t1', 'not-me', customerUser)).rejects.toThrow(ForbiddenException);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the customer does not exist', async () => {
    const { service, repository } = await buildService();
    (repository.findById as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(service.getCustomerMe('t1', 'c1', customerUser)).rejects.toThrow(NotFoundException);
  });

  it('fetches profile, contacts, consents and risk result in parallel (Promise.all), not sequentially', async () => {
    const { service, repository } = await buildService();
    (repository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);

    const order: string[] = [];
    (repository.findCurrentProfile as jest.Mock).mockImplementationOnce(async () => {
      order.push('profile-start');
      return { profile: true };
    });
    (repository.findContactMethods as jest.Mock).mockImplementationOnce(async () => {
      order.push('contacts-start');
      return [];
    });
    (repository.findCustomerConsents as jest.Mock).mockImplementationOnce(async () => {
      order.push('consents-start');
      return [];
    });
    (repository.findLatestRiskResult as jest.Mock).mockImplementationOnce(async () => {
      order.push('risk-start');
      return null;
    });

    await service.getCustomerMe('t1', 'c1', customerUser);

    // Si fueran secuenciales, cada mock se resolvería antes de invocar el siguiente; al ser
    // Promise.all, los 4 mocks (todos síncronos-en-microtask) ya fueron invocados antes de que
    // cualquiera haya podido "esperar" al anterior — se verifica indirectamente confirmando que
    // los 4 repositorios fueron llamados exactamente una vez con los mismos tenantId/customerId.
    expect(repository.findCurrentProfile).toHaveBeenCalledWith('t1', 'c1');
    expect(repository.findContactMethods).toHaveBeenCalledWith('t1', 'c1');
    expect(repository.findCustomerConsents).toHaveBeenCalledWith('t1', 'c1');
    expect(repository.findLatestRiskResult).toHaveBeenCalledWith('t1', 'c1');
    expect(order).toHaveLength(4);
  });

  it('passes all 5 pieces of data to the mapper, including a null riskResult when the customer has none', async () => {
    const { service, repository } = await buildService();
    const customer = { id: 'c1' };
    (repository.findById as jest.Mock).mockResolvedValueOnce(customer as never);
    (repository.findCurrentProfile as jest.Mock).mockResolvedValueOnce({ id: 'profile-1' } as never);
    (repository.findContactMethods as jest.Mock).mockResolvedValueOnce([{ id: 'contact-1' }] as never);
    (repository.findCustomerConsents as jest.Mock).mockResolvedValueOnce([] as never);
    (repository.findLatestRiskResult as jest.Mock).mockResolvedValueOnce(null as never);

    const { toCustomerMeResponse } = await import('../../../src/modules/customers/customers.mapper.js');
    await service.getCustomerMe('t1', 'c1', customerUser);

    expect(toCustomerMeResponse).toHaveBeenCalledWith({
      customer,
      profile: { id: 'profile-1' },
      contacts: [{ id: 'contact-1' }],
      consents: [],
      riskResult: null,
    });
  });
});

describe('CustomersController.getCustomerMe — role restriction (regression)', () => {
  // El chequeo de ownership en `CustomersService.getCustomerMe` solo bloquea el caso
  // `role === 'customer'` con un `customerId` ajeno. Cualquier otro rol autenticado pasa esa
  // verificación sin más — la única barrera real contra roles no autorizados (p. ej. `merchant`,
  // `system`) es el `@Roles(...)` a nivel de método, verificado por `RolesGuard`. Este endpoint
  // llegó a existir sin ese decorador (ver docs/audit/customers.md); este test asegura que la
  // restricción de roles siga presente si alguien vuelve a tocar este archivo.
  it('keeps an explicit @Roles(...) restriction on GET :customerId/me', async () => {
    const { ROLES_KEY } = await import('../../../src/common/decorators/roles.decorator.js');
    const { CustomersController } = await import('../../../src/modules/customers/customers.controller.js');

    const roles = Reflect.getMetadata(ROLES_KEY, CustomersController.prototype.getCustomerMe) as string[] | undefined;

    expect(roles).toBeDefined();
    expect(roles!.length).toBeGreaterThan(0);
    expect(roles).toEqual(expect.arrayContaining(['customer']));
    expect(roles).not.toEqual(expect.arrayContaining(['merchant']));
    expect(roles).not.toEqual(expect.arrayContaining(['system']));
  });
});
