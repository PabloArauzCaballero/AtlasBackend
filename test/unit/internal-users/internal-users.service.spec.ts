import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { InternalUsersService } from '../../../src/modules/internal-users/internal-users.service.js';

const currentUser = {
  sub: '10',
  tenantId: '1',
  internalUserId: '10',
  role: 'admin' as const,
};

function makeRepository(overrides: Record<string, unknown> = {}) {
  return {
    findUserById: jest.fn(async (_tenantId: string, internalUserId: string) => ({
      id: internalUserId,
      tenantId: '1',
      email: 'actor@atlas.internal',
      fullName: 'Actor Interno',
      userCode: 'actor',
      status: 'active',
      department: 'SYSTEMS',
      jobTitle: null,
      mustChangePassword: false,
      mfaEnabled: false,
    })),
    buildAccessProfile: jest.fn(async (user: { id: string }) => ({
      user: {
        id: user.id,
        tenantId: '1',
        email: 'actor@atlas.internal',
        fullName: 'Actor Interno',
        userCode: 'actor',
        status: 'active',
        department: 'SYSTEMS',
        jobTitle: null,
        mustChangePassword: false,
        mfaEnabled: false,
        roles: ['SYSTEMS_ADMIN'],
        permissions: [],
      },
    })),
    buildAccessProfiles: jest.fn(async (users: Array<{ id: string }>) =>
      users.map((user) => ({
        user: {
          id: user.id,
          tenantId: '1',
          email: `user${user.id}@atlas.internal`,
          fullName: `User ${user.id}`,
          userCode: `user${user.id}`,
          status: 'active',
          department: 'SYSTEMS',
          jobTitle: null,
          mustChangePassword: false,
          mfaEnabled: false,
          roles: ['SUPPORT_AGENT'],
          permissions: [],
        },
      })),
    ),
    listUsers: jest.fn(async (..._args: unknown[]) => ({ rows: [], total: 0 })),
    findUserByEmail: jest.fn(async (..._args: unknown[]) => null),
    findRolesByCodes: jest.fn(async (roleCodes: string[]) => roleCodes.map((roleCode, index) => ({ id: String(index + 1), roleCode }))),
    createUserWithCredentials: jest.fn(),
    updateUser: jest.fn(),
    replaceUserRoles: jest.fn(),
    hasPermissions: jest.fn(async (..._args: unknown[]) => false),
    createAudit: jest.fn(),
    ...overrides,
  };
}

function makeTokenRevocationService(overrides: Record<string, unknown> = {}) {
  return {
    getCurrentTokenVersion: jest.fn(),
    bumpTokenVersion: jest.fn(),
    bumpTokenVersionIfPresent: jest.fn(async (..._args: unknown[]) => 2),
    ...overrides,
  };
}

/**
 * El segundo factor de un usuario interno no sale de su ficha: lo decide la configuración del
 * despliegue, y `InternalUsersService` se lo pregunta a `AuthSecondFactorService` al componer el
 * perfil.
 */
function makeAuthService(inEffect = true) {
  return { isRequired: jest.fn((..._args: unknown[]) => inEffect) };
}

describe('InternalUsersService security boundaries', () => {
  it('rejects privileged role assignment when actor is not SUPER_ADMIN', async () => {
    const repository = makeRepository();
    const service = new InternalUsersService(repository as never, makeTokenRevocationService() as never, makeAuthService() as never);

    await expect(
      service.createUser(
        currentUser,
        {
          email: 'new.admin@atlas.internal',
          fullName: 'New Admin',
          department: 'SYSTEMS',
          password: 'Atlas_NewAdmin#2026!',
          mustChangePassword: true,
          roles: ['SUPER_ADMIN'],
          reason: 'controlado por auditoria',
        },
        { ipAddress: '127.0.0.1', userAgent: 'jest' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires explicit disable permission for disabled-like statuses', async () => {
    const repository = makeRepository({ hasPermissions: jest.fn(async (..._args: unknown[]) => false) });
    const service = new InternalUsersService(repository as never, makeTokenRevocationService() as never, makeAuthService() as never);

    await expect(
      service.updateUser(
        currentUser,
        '11',
        { status: 'disabled', reason: 'baja operativa aprobada' },
        { ipAddress: '127.0.0.1', userAgent: 'jest' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not allow replacing your own internal roles', async () => {
    const repository = makeRepository();
    const service = new InternalUsersService(repository as never, makeTokenRevocationService() as never, makeAuthService() as never);

    await expect(
      service.replaceRoles(
        currentUser,
        currentUser.internalUserId,
        { roles: ['RISK_ANALYST'], reason: 'evitar bloqueo accidental' },
        { ipAddress: '127.0.0.1', userAgent: 'jest' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects stripping a privileged role from the target when the actor is not SUPER_ADMIN (regression)', async () => {
    // El actor ('10') es INTERNAL_IDENTITY_ADMIN, NO SUPER_ADMIN. El objetivo ('11') tiene hoy
    // SUPER_ADMIN. La lista nueva de roles NO incluye ningún rol privilegiado — antes del fix,
    // `assertCanAssignRequestedRoles` solo miraba la lista nueva y dejaba pasar esto, despojando
    // en silencio el SUPER_ADMIN del objetivo sin que el actor probara ser SUPER_ADMIN.
    const repository = makeRepository({
      buildAccessProfile: jest.fn(async (user: { id: string }) => ({
        user: {
          id: user.id,
          tenantId: '1',
          email: 'x@atlas.internal',
          fullName: 'X',
          userCode: 'x',
          status: 'active',
          department: 'SYSTEMS',
          jobTitle: null,
          mustChangePassword: false,
          mfaEnabled: false,
          roles: user.id === '11' ? ['SUPER_ADMIN'] : ['INTERNAL_IDENTITY_ADMIN'],
          permissions: [],
        },
      })),
    });
    const service = new InternalUsersService(repository as never, makeTokenRevocationService() as never, makeAuthService() as never);

    await expect(
      service.replaceRoles(
        currentUser,
        '11',
        { roles: ['SUPPORT_AGENT'], reason: 'reorganizacion de equipo' },
        { ipAddress: '127.0.0.1', userAgent: 'jest' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('invalidates the currently active access token when an internal user is disabled (regression)', async () => {
    const repository = makeRepository({
      hasPermissions: jest.fn(async (..._args: unknown[]) => true),
      updateUser: jest.fn(async (user: { id: string }) => user),
    });
    const tokenRevocationService = makeTokenRevocationService();
    const service = new InternalUsersService(repository as never, tokenRevocationService as never, makeAuthService() as never);

    await service.updateUser(
      currentUser,
      '11',
      { status: 'disabled', reason: 'baja operativa aprobada' },
      { ipAddress: null, userAgent: null },
    );

    expect(tokenRevocationService.bumpTokenVersionIfPresent).toHaveBeenCalledWith('internal_user', '11');
  });

  it('invalidates the currently active access token when internal roles are replaced (regression)', async () => {
    // El claim `role` del access token sale de `internal_users.role_code`, que `replaceUserRoles`
    // reescribe; `RolesGuard` autoriza leyendo ese claim, no la base. Sin revocación, degradar a un
    // administrador lo dejaba operando con su rol anterior hasta que el token expirara solo, y en esa
    // ventana conservaba `POST /auth/provision-credentials` para fabricarse acceso persistente.
    const nonPrivilegedProfile = jest.fn(async (user: { id: string }) => ({
      user: {
        id: user.id,
        tenantId: '1',
        email: 'x@atlas.internal',
        fullName: 'X',
        userCode: 'x',
        status: 'active',
        department: 'SYSTEMS',
        jobTitle: null,
        mustChangePassword: false,
        mfaEnabled: false,
        roles: ['SUPPORT_AGENT'],
        permissions: [],
      },
    }));
    const repository = makeRepository({ buildAccessProfile: nonPrivilegedProfile });
    const tokenRevocationService = makeTokenRevocationService();
    const service = new InternalUsersService(repository as never, tokenRevocationService as never, makeAuthService() as never);

    await service.replaceRoles(
      currentUser,
      '11',
      { roles: ['RISK_ANALYST'], reason: 'reorganizacion de equipo' },
      { ipAddress: null, userAgent: null },
    );

    expect(repository.replaceUserRoles).toHaveBeenCalled();
    expect(tokenRevocationService.bumpTokenVersionIfPresent).toHaveBeenCalledWith('internal_user', '11');
  });

  it('still replaces roles when the target has no credentials to revoke', async () => {
    // Un usuario interno creado por seed y aún sin contraseña provisionada no tiene fila en
    // `auth_credentials`. No hay sesión que revocar, así que el cambio de roles debe completarse y
    // auditarse igual — no convertirse en un 500 con los roles ya reemplazados.
    const nonPrivilegedProfile = jest.fn(async (user: { id: string }) => ({
      user: {
        id: user.id,
        tenantId: '1',
        email: 'x@atlas.internal',
        fullName: 'X',
        userCode: 'x',
        status: 'active',
        department: 'SYSTEMS',
        jobTitle: null,
        mustChangePassword: false,
        mfaEnabled: false,
        roles: ['SUPPORT_AGENT'],
        permissions: [],
      },
    }));
    const repository = makeRepository({ buildAccessProfile: nonPrivilegedProfile });
    const tokenRevocationService = makeTokenRevocationService({ bumpTokenVersionIfPresent: jest.fn(async (..._args: unknown[]) => null) });
    const service = new InternalUsersService(repository as never, tokenRevocationService as never, makeAuthService() as never);

    await expect(
      service.replaceRoles(
        currentUser,
        '11',
        { roles: ['RISK_ANALYST'], reason: 'reorganizacion de equipo' },
        { ipAddress: null, userAgent: null },
      ),
    ).resolves.toBeDefined();

    expect(repository.createAudit).toHaveBeenCalled();
  });

  it('listUsers batches role/permission lookups via buildAccessProfiles instead of one call per user (N+1 regression)', async () => {
    const rows = [
      { id: '20', tenantId: '1' },
      { id: '21', tenantId: '1' },
      { id: '22', tenantId: '1' },
    ];
    const repository = makeRepository({ listUsers: jest.fn(async (..._args: unknown[]) => ({ rows, total: 3 })) });
    const service = new InternalUsersService(repository as never, makeTokenRevocationService() as never, makeAuthService() as never);

    const result = await service.listUsers(currentUser, { page: 1, limit: 50 });

    expect(repository.listUsers).toHaveBeenCalledWith('1', { page: 1, limit: 50 });
    // Un solo llamado con las 3 filas de la página, no 3 llamados individuales.
    expect(repository.buildAccessProfiles).toHaveBeenCalledTimes(1);
    expect(repository.buildAccessProfiles).toHaveBeenCalledWith(rows);
    expect(repository.buildAccessProfile).not.toHaveBeenCalled();
    expect(result.items.map((item) => item.id)).toEqual(['20', '21', '22']);
    expect(result.meta).toEqual({ page: 1, limit: 50, total: 3, totalPages: 1 });
  });
});
