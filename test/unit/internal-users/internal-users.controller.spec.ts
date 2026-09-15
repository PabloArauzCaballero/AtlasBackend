import { describe, expect, it, jest } from '@jest/globals';
import { InternalUsersController } from '../../../src/modules/internal-users/internal-users.controller.js';
import { requestMeta } from '../../../src/common/utils/http/headers.util.js';

/**
 * `InternalUsersController` delega en `InternalUsersService` pasando el currentUser (la guardia de
 * permisos internos actúa antes) y, en las mutaciones, la metadata de red del request (requestMeta).
 * Spec directo con el servicio mockeado.
 */
describe('InternalUsersController', () => {
  function build() {
    const service = {
      listUsers: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
      getUser: jest.fn(async (..._args: unknown[]) => ({ id: '5' })),
      updateUser: jest.fn(async (..._args: unknown[]) => ({ id: '5' })),
      replaceRoles: jest.fn(async (..._args: unknown[]) => ({ id: '5' })),
    };
    return { controller: new InternalUsersController(service as never), service };
  }
  const user = { role: 'system_admin', tenantId: '1', internalUserId: 'u1' } as never;
  const request = { ip: '1.1.1.1', headers: { 'user-agent': 'jest' } } as never;

  it('list y get delegan con el currentUser', async () => {
    const { controller, service } = build();
    await controller.list({ page: 1 } as never, user);
    await controller.get({ internalUserId: '5' } as never, user);
    expect(service.listUsers).toHaveBeenCalledWith(user, { page: 1 });
    expect(service.getUser).toHaveBeenCalledWith(user, '5');
  });

  it('update y replaceRoles pasan la metadata de red (requestMeta)', async () => {
    const { controller, service } = build();
    const upd = { fullName: 'X' } as never;
    const roles = { roleCodes: ['risk_analyst'] } as never;
    await controller.update({ internalUserId: '5' } as never, upd, user, request);
    await controller.replaceRoles({ internalUserId: '5' } as never, roles, user, request);
    expect(service.updateUser).toHaveBeenCalledWith(user, '5', upd, requestMeta(request));
    expect(service.replaceRoles).toHaveBeenCalledWith(user, '5', roles, requestMeta(request));
  });
});
