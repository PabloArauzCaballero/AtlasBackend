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
    findUserByEmail: jest.fn(async () => null),
    findRolesByCodes: jest.fn(async (roleCodes: string[]) => roleCodes.map((roleCode, index) => ({ id: String(index + 1), roleCode }))),
    createUserWithCredentials: jest.fn(),
    updateUser: jest.fn(),
    replaceUserRoles: jest.fn(),
    hasPermissions: jest.fn(async () => false),
    createAudit: jest.fn(),
    ...overrides,
  };
}

function makeTokenRevocationService(overrides: Record<string, unknown> = {}) {
  return {
    getCurrentTokenVersion: jest.fn(),
    bumpTokenVersion: jest.fn(),
    ...overrides,
  };
}

describe('InternalUsersService security boundaries', () => {
  it('rejects privileged role assignment when actor is not SUPER_ADMIN', async () => {
    const repository = makeRepository();
    const service = new InternalUsersService(repository as never, makeTokenRevocationService() as never);

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
    const repository = makeRepository({ hasPermissions: jest.fn(async () => false) });
    const service = new InternalUsersService(repository as never, makeTokenRevocationService() as never);

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
    const service = new InternalUsersService(repository as never, makeTokenRevocationService() as never);

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
    const service = new InternalUsersService(repository as never, makeTokenRevocationService() as never);

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
      hasPermissions: jest.fn(async () => true),
      updateUser: jest.fn(async (user: { id: string }) => user),
    });
    const tokenRevocationService = makeTokenRevocationService();
    const service = new InternalUsersService(repository as never, tokenRevocationService as never);

    await service.updateUser(currentUser, '11', { status: 'disabled', reason: 'baja operativa aprobada' }, { ipAddress: null, userAgent: null });

    expect(tokenRevocationService.bumpTokenVersion).toHaveBeenCalledWith('internal_user', '11');
  });
});
