import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { InternalPermissionsGuard } from '../../../src/modules/internal-users/guards/internal-permissions.guard.js';

/**
 * `InternalPermissionsGuard.canActivate`: sin permisos requeridos pasa; con permisos exige sesión
 * interna (tenant + internalUserId) y que el RBAC conceda el acceso. Spec directo con reflector y
 * repo mockeados + un ExecutionContext falso.
 */
describe('InternalPermissionsGuard', () => {
  function build() {
    const reflector = { getAllAndOverride: jest.fn() };
    const rbacRepository = { hasPermissions: jest.fn() };
    const guard = new InternalPermissionsGuard(reflector as never, rbacRepository as never);
    return { guard, reflector, rbacRepository };
  }
  const ctx = (user: unknown) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as never;

  it('permite cuando no hay permisos requeridos', async () => {
    const { guard, reflector } = build();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    expect(await guard.canActivate(ctx({}))).toBe(true);
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([]);
    expect(await guard.canActivate(ctx({}))).toBe(true);
  });

  it('Forbidden si hay permisos requeridos pero no hay sesión interna', async () => {
    const { guard, reflector } = build();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['internal.users.read']);
    await expect(guard.canActivate(ctx(undefined))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx({ tenantId: '1' }))).rejects.toBeInstanceOf(ForbiddenException); // sin internalUserId
  });

  it('Forbidden si el RBAC no concede el permiso; true si lo concede', async () => {
    const { guard, reflector, rbacRepository } = build();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['internal.users.read']);
    (rbacRepository.hasPermissions as jest.Mock).mockResolvedValueOnce(false as never);
    await expect(guard.canActivate(ctx({ tenantId: '1', internalUserId: 'u1' }))).rejects.toBeInstanceOf(ForbiddenException);
    (rbacRepository.hasPermissions as jest.Mock).mockResolvedValueOnce(true as never);
    expect(await guard.canActivate(ctx({ tenantId: '1', internalUserId: 'u1' }))).toBe(true);
  });
});
