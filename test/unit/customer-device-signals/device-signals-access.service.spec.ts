import { ForbiddenException } from '@nestjs/common';
import { DeviceSignalsAccessService } from '../../../src/modules/customer-device-signals/application/device-signals-access.service';
import type { CustomerDeviceContactsRepository } from '../../../src/modules/customer-device-signals/repositories/customer-device-contacts.repository';
import type { CustomersRepository } from '../../../src/modules/customers/customers.repository';
import type { InternalRbacRepository } from '../../../src/modules/internal-users/internal-rbac.repository';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types';

function build(allowed = true) {
  const rbac = { hasPermissions: jest.fn(async () => allowed) };
  const service = new DeviceSignalsAccessService(
    {} as CustomersRepository,
    {} as CustomerDeviceContactsRepository,
    rbac as unknown as InternalRbacRepository,
  );
  return { service, rbac };
}

const como = (user: Record<string, unknown>) => user as unknown as AuthenticatedUser;

describe('DeviceSignalsAccessService.assertMayPurge', () => {
  it('un cliente borra su propia agenda sin permiso interno', async () => {
    const { service, rbac } = build(false);
    await expect(service.assertMayPurge('t1', como({ role: 'customer' }))).resolves.toBeUndefined();
    expect(rbac.hasPermissions).not.toHaveBeenCalled();
  });

  it('un operador interno necesita privacy.requests.manage', async () => {
    const denegado = build(false);
    await expect(denegado.service.assertMayPurge('t1', como({ role: 'internal_operator', internalUserId: '5' }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(denegado.rbac.hasPermissions).toHaveBeenCalledWith('t1', '5', ['privacy.requests.manage']);

    const concedido = build(true);
    await expect(concedido.service.assertMayPurge('t1', como({ role: 'admin', internalUserId: '6' }))).resolves.toBeUndefined();
  });

  it('un rol interno sin sesión interna no pasa', async () => {
    const { service, rbac } = build(true);
    await expect(service.assertMayPurge('t1', como({ role: 'admin' }))).rejects.toThrow(ForbiddenException);
    expect(rbac.hasPermissions).not.toHaveBeenCalled();
  });
});
