import { describe, expect, it, jest } from '@jest/globals';
import { CustomersController } from '../../../src/modules/customers/customers.controller.js';

/**
 * `CustomersController.getCustomerMe` delega en `CustomersService` con el tenant ya resuelto.
 *
 * Antes este spec probaba también la caída al tenant del token cuando no venía el header. Esa regla
 * ya no vive aquí: la resolución (header → token → query, y 400 si no hay ninguno) se movió a
 * `@CurrentTenant()`, y la prueba está en `current-tenant.decorator.spec.ts`, donde se ejecuta una
 * sola vez en vez de repetirse en cada controlador que la usaba.
 */
describe('CustomersController', () => {
  function build() {
    const service = { getCustomerMe: jest.fn(async (..._args: unknown[]) => ({ id: '9' })) };
    return { controller: new CustomersController(service as never), service };
  }
  const currentUser = { tenantId: '5', customerId: '9' } as never;

  it('delega en el servicio con el tenant que le entrega el decorador', async () => {
    const { controller, service } = build();

    await controller.getCustomerMe('1', { customerId: '9' } as never, currentUser);

    expect(service.getCustomerMe).toHaveBeenCalledWith('1', '9', currentUser);
  });
});
