import { describe, expect, it, jest } from '@jest/globals';
import { InternalAccessCatalogController } from '../../../src/modules/internal-users/internal-access-catalog.controller.js';

/**
 * `InternalAccessCatalogController` expone el catálogo de roles/permisos internos, delegando en su
 * servicio con el `currentUser` (la guardia de permisos internos actúa antes). Spec directo.
 */
describe('InternalAccessCatalogController', () => {
  function build() {
    const service = {
      listRoles: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
      getRole: jest.fn(async (..._args: unknown[]) => ({ id: '5' })),
      listPermissions: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
    };
    return { controller: new InternalAccessCatalogController(service as never), service };
  }
  const user = { role: 'system_admin', tenantId: '1', internalUserId: 'u1' } as never;

  it('listRoles delega con el currentUser', async () => {
    const { controller, service } = build();
    await controller.listRoles(user);
    expect(service.listRoles).toHaveBeenCalledWith(user);
  });

  it('getRole delega con currentUser y roleId', async () => {
    const { controller, service } = build();
    await controller.getRole({ roleId: '5' } as never, user);
    expect(service.getRole).toHaveBeenCalledWith(user, '5');
  });

  it('listPermissions delega con el currentUser', async () => {
    const { controller, service } = build();
    await controller.listPermissions(user);
    expect(service.listPermissions).toHaveBeenCalledWith(user);
  });
});
