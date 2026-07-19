import { describe, expect, it, jest } from '@jest/globals';
import { InternalRbacRepository } from '../../../src/modules/internal-users/internal-rbac.repository.js';

/**
 * Cobertura directa de `InternalRbacRepository` (Fase 1.2 del plan 10/10): finders de usuarios
 * internos y roles. El servicio lo mockea, así que su capa de lectura no se ejercitaba. Los modelos
 * y la conexión se mockean.
 */
describe('InternalRbacRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn(), update: jest.fn(), bulkCreate: jest.fn() });
    const models = {
      internalUser: make(),
      role: make(),
      permission: make(),
      rolePermission: make(),
      userRole: make(),
      credential: make(),
      audit: make(),
    };
    const sequelize = { query: jest.fn(), transaction: jest.fn(async (cb: (tx: string) => unknown) => cb('tx')) };
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
    return { repo, models, sequelize };
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

  // --- Mutaciones transaccionales -------------------------------------------------------------

  it('createUserWithCredentials crea usuario + credencial + roles en una transacción', async () => {
    const { repo, models } = buildRepo();
    (models.internalUser.create as jest.Mock).mockResolvedValue({ id: 'u1' } as never);
    (models.role.findAll as jest.Mock).mockResolvedValue([{ id: 'r1' }] as never);
    const user = await repo.createUserWithCredentials({
      tenantId: 't1',
      userCode: 'U1',
      fullName: 'Ana',
      email: 'a@x',
      legacyRoleCode: 'admin',
      department: 'ops',
      jobTitle: 'x',
      mustChangePassword: true,
      createdByInternalUserId: 'admin1',
      passwordHash: 'h',
      roleCodes: ['admin'],
    } as never);
    expect(user).toEqual({ id: 'u1' });
    expect(models.internalUser.create).toHaveBeenCalledTimes(1);
    expect(models.credential.create).toHaveBeenCalledTimes(1);
    expect(models.userRole.bulkCreate).toHaveBeenCalledTimes(1);
  });

  it('updateUser asigna solo los campos presentes y guarda', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => undefined);
    const user = { fullName: 'orig', department: 'd', status: 's', save } as never;
    await repo.updateUser(user, { fullName: 'nuevo', updatedByInternalUserId: 'admin1' });
    expect((user as { fullName: string }).fullName).toBe('nuevo');
    expect((user as { department: string }).department).toBe('d'); // no venía en values -> intacto
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('replaceUserRoles revoca los activos, reasigna y actualiza el rol legacy', async () => {
    const { repo, models } = buildRepo();
    (models.role.findAll as jest.Mock).mockResolvedValue([{ id: 'r1' }] as never);
    await repo.replaceUserRoles({
      tenantId: 't1',
      internalUserId: 'u1',
      roleCodes: ['admin'],
      assignedByInternalUserId: 'a1',
      legacyRoleCode: 'admin',
      reason: 'change',
    });
    expect(models.userRole.update).toHaveBeenCalledTimes(1); // revocación de activos
    expect(models.userRole.bulkCreate).toHaveBeenCalledTimes(1); // reasignación
    expect(models.internalUser.update).toHaveBeenCalledTimes(1); // rol legacy
  });

  it('createAudit fija actorType internal_user/system y funde reason+metadata', async () => {
    const { repo, models } = buildRepo();
    await repo.createAudit({ tenantId: 't1', actorInternalUserId: 'u1', actionCode: 'X', targetType: 't', targetId: '1', reason: 'r', metadata: { k: 1 } });
    expect((models.audit.create as jest.Mock).mock.calls[0][0]).toMatchObject({ actorType: 'internal_user', payloadJson: { reason: 'r', k: 1 } });
    await repo.createAudit({ tenantId: 't1', actorInternalUserId: null, actionCode: 'X', targetType: 't', targetId: null, reason: null });
    expect((models.audit.create as jest.Mock).mock.calls[1][0].actorType).toBe('system');
  });

  // --- Perfiles de acceso y permisos (SQL crudo) ----------------------------------------------

  it('buildAccessProfile lee permisos por SQL, expande alias y deduplica roles', async () => {
    const { repo, sequelize } = buildRepo();
    (sequelize.query as jest.Mock).mockResolvedValue([
      { roleCode: 'admin', legacyRoleCode: 'admin', permissionCode: 'internal.users.read' },
      { roleCode: 'admin', legacyRoleCode: 'admin', permissionCode: null },
    ] as never);
    const profile = await repo.buildAccessProfile({ id: 'u1', tenantId: 't1', email: 'a@x', fullName: 'Ana', userCode: 'U', status: 'active' } as never);
    expect(profile.user.roles).toEqual(['admin']);
    expect(profile.user.permissions).toEqual(expect.arrayContaining(['internal.users.read', 'rbac.internal_users.read']));
  });

  it('hasPermissions es true solo si todos los permisos (o su alias) están presentes', async () => {
    const { repo, sequelize } = buildRepo();
    (sequelize.query as jest.Mock).mockResolvedValue([{ roleCode: 'admin', legacyRoleCode: null, permissionCode: 'rbac.internal_users.read' }] as never);
    expect(await repo.hasPermissions('t1', 'u1', ['internal.users.read'])).toBe(true); // vía alias
    expect(await repo.hasPermissions('t1', 'u1', ['internal.roles.manage'])).toBe(false);
  });

  it('buildAccessProfiles corta con lista vacía y agrupa filas por usuario', async () => {
    const { repo, sequelize } = buildRepo();
    expect(await repo.buildAccessProfiles([])).toEqual([]);
    (sequelize.query as jest.Mock).mockResolvedValue([
      { internalUserId: 'u1', roleCode: 'admin', legacyRoleCode: 'admin', permissionCode: 'internal.users.read' },
    ] as never);
    const profiles = await repo.buildAccessProfiles([
      { id: 'u1', tenantId: 't1', fullName: 'Ana' },
      { id: 'u2', tenantId: 't1', fullName: 'Bob' },
    ] as never);
    expect(profiles).toHaveLength(2);
    expect(profiles[0].user.roles).toEqual(['admin']);
    expect(profiles[1].user.roles).toEqual([]); // u2 sin filas
  });
});
