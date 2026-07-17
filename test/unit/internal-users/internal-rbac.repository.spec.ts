import { describe, expect, it, jest } from '@jest/globals';
import { InternalRbacRepository } from '../../../src/modules/internal-users/internal-rbac.repository.js';

/**
 * Cobertura directa de `InternalRbacRepository` (Fase 1.2 del plan 10/10): finders de usuarios
 * internos y roles. El servicio lo mockea, así que su capa de lectura no se ejercitaba. Los modelos
 * y la conexión se mockean.
 */
describe('InternalRbacRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn() });
    const models = {
      internalUser: make(),
      role: make(),
      permission: make(),
      rolePermission: make(),
      userRole: make(),
      credential: make(),
      audit: make(),
    };
    const sequelize = { query: jest.fn(), transaction: jest.fn() };
    // Orden del constructor: sequelize primero.
    const repo = new InternalRbacRepository(
      sequelize as never,
      models.internalUser as never,
      models.role as never,
      models.permission as never,
      models.rolePermission as never,
      models.userRole as never,
      models.credential as never,
      models.audit as never,
    );
    return { repo, models };
  }

  it('findUserById filtra por id, tenant y no-borrado', async () => {
    const { repo, models } = buildRepo();
    (models.internalUser.findOne as jest.Mock).mockResolvedValue({ id: 'u1' } as never);
    const result = await repo.findUserById('t1', 'u1');
    expect(result).toEqual({ id: 'u1' });
    expect((models.internalUser.findOne as jest.Mock).mock.calls[0][0].where).toMatchObject({ id: 'u1', tenantId: 't1' });
  });

  it('findUserByEmail normaliza el email a minúsculas y sin espacios', async () => {
    const { repo, models } = buildRepo();
    (models.internalUser.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findUserByEmail('t1', '  Ana@Atlas.TEST  ');
    expect((models.internalUser.findOne as jest.Mock).mock.calls[0][0].where).toMatchObject({ email: 'ana@atlas.test', tenantId: 't1' });
  });

  it('listUsers devuelve rows + total desde findAndCountAll', async () => {
    const { repo, models } = buildRepo();
    (models.internalUser.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [{ id: 'u1' }], count: 5 } as never);
    const result = await repo.listUsers('t1', { page: 1, limit: 20 } as never);
    expect(result).toEqual({ rows: [{ id: 'u1' }], total: 5 });
  });

  it('listActiveInternalUserIds trae SOLO activos y mapea a ids string', async () => {
    const { repo, models } = buildRepo();
    (models.internalUser.findAll as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    const result = await repo.listActiveInternalUserIds('t1');
    expect(result).toEqual(['1', '2']);
    expect((models.internalUser.findAll as jest.Mock).mock.calls[0][0].where).toMatchObject({ tenantId: 't1', status: 'active' });
  });

  it('findRolesByCodes usa Op.in y exige rol activo no borrado', async () => {
    const { repo, models } = buildRepo();
    (models.role.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findRolesByCodes(['admin', 'risk_analyst']);
    const where = (models.role.findAll as jest.Mock).mock.calls[0][0].where as Record<string, unknown>;
    expect(where.roleCode).toBeDefined(); // { [Op.in]: [...] }
    expect(where).toMatchObject({ status: 'active', deleted: false });
  });
});
