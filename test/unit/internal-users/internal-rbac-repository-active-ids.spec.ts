import { describe, expect, it, jest } from '@jest/globals';
import { InternalRbacRepository } from '../../../src/modules/internal-users/internal-rbac.repository.js';

/**
 * `listActiveInternalUserIds` resuelve el destinatario "todos los usuarios internos" de un
 * broadcast de admin y de las alertas automáticas de `SystemsHealthMonitorService`. A diferencia
 * de `listUsers` (que solo excluye eliminados), este método también exige `status: 'active'` —
 * no tiene sentido notificar a cuentas invitadas/suspendidas/bloqueadas.
 */
function buildRepository(internalUserModel: Record<string, jest.Mock>) {
  return new InternalRbacRepository(
    {} as never, // sequelize
    internalUserModel as never,
    {} as never, // roleModel
    {} as never, // permissionModel
    {} as never, // rolePermissionModel
    {} as never, // userRoleModel
    {} as never, // credentialModel
    {} as never, // auditModel
  );
}

describe('InternalRbacRepository.listActiveInternalUserIds', () => {
  it('filters by tenantId, not-deleted, AND status: active', async () => {
    const internalUserModel = { findAll: jest.fn(async () => [{ id: '10' }, { id: '11' }]) };
    const repository = buildRepository(internalUserModel);

    const ids = await repository.listActiveInternalUserIds('t1');

    expect(ids).toEqual(['10', '11']);
    const callArgs = (internalUserModel.findAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArgs.where).toMatchObject({ tenantId: 't1', status: 'active' });
  });

  it('returns an empty array when there are no active users, without throwing', async () => {
    const internalUserModel = { findAll: jest.fn(async () => []) };
    const repository = buildRepository(internalUserModel);

    await expect(repository.listActiveInternalUserIds('t1')).resolves.toEqual([]);
  });
});
