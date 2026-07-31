import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { Op } from 'sequelize';
import { InternalAccessCatalogRepository } from '../../../src/modules/internal-users/internal-access-catalog.repository.js';

/**
 * Cobertura directa de `InternalAccessCatalogRepository` (Fase 1.2 del plan 10/10): catálogo de roles
 * (SQL crudo con LEFT JOIN a permisos) y de permisos (mapeo a DTO). Conexión + modelo mockeados.
 */
describe('InternalAccessCatalogRepository', () => {
  function buildRepo() {
    const sequelize = { query: asyncMock() };
    const permissionModel = { findAll: asyncMock() };
    const repo = new InternalAccessCatalogRepository(sequelize as never, permissionModel as never);
    return { repo, sequelize, permissionModel };
  }

  it('listRoleRows filtra por no borrados sin replacements', async () => {
    const { repo, sequelize } = buildRepo();
    (sequelize.query as jest.Mock).mockResolvedValue([] as never);
    await repo.listRoleRows();
    const [sql, opts] = (sequelize.query as jest.Mock).mock.calls[0] as [string, { replacements: Record<string, unknown> }];
    expect(sql).toContain('r._deleted = false');
    expect(opts.replacements).toEqual({});
  });

  it('findRoleRowsById pasa el roleId como replacement y filtra por _id', async () => {
    const { repo, sequelize } = buildRepo();
    (sequelize.query as jest.Mock).mockResolvedValue([] as never);
    await repo.findRoleRowsById('42');
    const [sql, opts] = (sequelize.query as jest.Mock).mock.calls[0] as [string, { replacements: Record<string, unknown> }];
    expect(sql).toContain('r._id = :roleId');
    expect(opts.replacements).toEqual({ roleId: '42' });
  });

  it('el JOIN de permisos excluye permisos borrados/inactivos', async () => {
    const { repo, sequelize } = buildRepo();
    (sequelize.query as jest.Mock).mockResolvedValue([] as never);
    await repo.listRoleRows();
    const sql = (sequelize.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain("p._deleted = false AND p.status = 'active'");
  });

  it('listPermissions filtra activos/no borrados y mapea cada permiso al DTO', async () => {
    const { repo, permissionModel } = buildRepo();
    (permissionModel.findAll as jest.Mock).mockResolvedValue([
      {
        id: '1',
        permissionCode: 'customers.read',
        moduleCode: 'customers',
        resourceCode: 'customer',
        actionCode: 'read',
        description: 'Leer',
        riskLevel: 'low',
        requiresReason: false,
        requiresMfa: false,
      },
    ] as never);
    const result = await repo.listPermissions();
    const where = callArg<CallArgRecord>(permissionModel.findAll, 0, 0).where as Record<string, unknown>;
    expect(where.status).toBe('active');
    expect((where.deleted as Record<symbol, unknown>)[Op.ne]).toBe(true);
    expect(result[0]).toEqual({
      id: '1',
      code: 'customers.read',
      module: 'customers',
      resource: 'customer',
      action: 'read',
      description: 'Leer',
      riskLevel: 'low',
      requiresReason: false,
      requiresMfa: false,
    });
  });
});
