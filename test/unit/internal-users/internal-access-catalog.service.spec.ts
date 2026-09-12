import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InternalAccessCatalogService } from '../../../src/modules/internal-users/internal-access-catalog.service.js';

/**
 * `InternalAccessCatalogService` expone el catálogo de roles/permisos internos. Toda operación exige
 * sesión interna (tenant + internalUserId) y agrupa las filas planas del repo en roles con sus
 * permisos deduplicados y ordenados. Spec directo con el repo mockeado.
 */
describe('InternalAccessCatalogService', () => {
  function build() {
    const catalogRepository = {
      listRoleRows: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      findRoleRowsById: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      listPermissions: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
    };
    const service = new InternalAccessCatalogService(catalogRepository as never);
    return { service, catalogRepository };
  }

  const internalUser = { tenantId: 't1', internalUserId: 'u1' } as never;
  const externalUser = { tenantId: null, internalUserId: null } as never;

  const roleRow = (permissionCode: string | null) => ({
    id: '5',
    code: 'RISK_ANALYST',
    name: 'Analista de riesgo',
    description: 'desc',
    department: 'risk',
    legacyRoleCode: 'risk_analyst',
    status: 'active',
    permissionCode,
  });

  it('listRoles agrupa las filas por rol y deduplica/ordena los permisos', async () => {
    const { service, catalogRepository } = build();
    (catalogRepository.listRoleRows as jest.Mock).mockResolvedValueOnce([
      roleRow('risk.write'),
      roleRow('risk.read'),
      roleRow('risk.read'), // duplicado
      roleRow(null), // se descarta
    ] as never);
    const { items } = await service.listRoles(internalUser);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: '5', code: 'RISK_ANALYST', permissions: ['risk.read', 'risk.write'] });
  });

  it('cualquier operación exige sesión interna (Forbidden si falta tenant/internalUserId)', async () => {
    const { service } = build();
    await expect(service.listRoles(externalUser)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listPermissions(externalUser)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getRole(externalUser, '5')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getRole devuelve el rol cuando existe', async () => {
    const { service, catalogRepository } = build();
    (catalogRepository.findRoleRowsById as jest.Mock).mockResolvedValueOnce([roleRow('risk.read')] as never);
    const role = await service.getRole(internalUser, '5');
    expect(role).toMatchObject({ id: '5', code: 'RISK_ANALYST', permissions: ['risk.read'] });
    expect(catalogRepository.findRoleRowsById).toHaveBeenCalledWith('5');
  });

  it('getRole lanza NotFound cuando no hay filas para el id', async () => {
    const { service } = build();
    await expect(service.getRole(internalUser, '5')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listPermissions delega en el repo bajo sesión interna', async () => {
    const { service, catalogRepository } = build();
    (catalogRepository.listPermissions as jest.Mock).mockResolvedValueOnce([{ code: 'risk.read', name: 'Leer riesgo' }] as never);
    const { items } = await service.listPermissions(internalUser);
    expect(items).toEqual([{ code: 'risk.read', name: 'Leer riesgo' }]);
  });
});
