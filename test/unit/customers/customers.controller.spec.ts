import { describe, expect, it, jest } from '@jest/globals';
import { CustomersController } from '../../../src/modules/customers/customers.controller.js';
import { parsePositiveId } from '../../../src/common/utils/ids/id.util.js';

/**
 * `CustomersController.getCustomerMe` resuelve el tenant desde el header `x-tenant-id` con fallback al
 * tenant del token, y delega en `CustomersService`. Spec directo con el servicio mockeado.
 */
describe('CustomersController', () => {
  function build() {
    const service = { getCustomerMe: jest.fn(async (..._args: unknown[]) => ({ id: '9' })) };
    return { controller: new CustomersController(service as never), service };
  }
  const currentUser = { tenantId: '5', customerId: '9' } as never;

  it('usa el x-tenant-id del header cuando está presente', async () => {
    const { controller, service } = build();
    await controller.getCustomerMe('1', { customerId: '9' } as never, currentUser);
    expect(service.getCustomerMe).toHaveBeenCalledWith(parsePositiveId('1', 'x-tenant-id'), '9', currentUser);
  });

  it('cae al tenant del token cuando no viene el header', async () => {
    const { controller, service } = build();
    await controller.getCustomerMe(undefined, { customerId: '9' } as never, currentUser);
    expect(service.getCustomerMe).toHaveBeenCalledWith(parsePositiveId('5', 'x-tenant-id'), '9', currentUser);
  });
});
