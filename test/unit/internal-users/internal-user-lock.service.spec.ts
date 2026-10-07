import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { InternalUserLockService } from '../../../src/modules/internal-users/internal-user-lock.service.js';

/**
 * Desbloquear una cuenta interna sin tocar la base (B14). Lo que se fija es lo que sale mal en
 * silencio: desbloquear sin dejar auditoría, «desbloquear» lo que no estaba bloqueado, y tratar un
 * `locked_until` ya vencido como si siguiera vigente.
 */
const AHORA = new Date('2026-09-26T12:00:00.000Z');
const FUTURO = new Date('2026-09-26T12:15:00.000Z');
const PASADO = new Date('2026-09-26T11:00:00.000Z');
const actor = { sub: '10', tenantId: '1', internalUserId: '10', role: 'admin' as const };
const red = { ipAddress: '1.1.1.1', userAgent: 'jest' };

function montar(
  opciones: { credential?: Record<string, unknown> | null; user?: Record<string, unknown> | null; roles?: (id: string) => string[] } = {},
) {
  const roles = opciones.roles ?? ((id: string) => (id === '10' ? ['SUPER_ADMIN'] : ['SUPPORT_AGENT']));
  const credential =
    opciones.credential === null
      ? null
      : {
          lockedUntil: FUTURO,
          failedLoginAttempts: 3,
          updatedAtValue: null as Date | null,
          save: jest.fn(async () => undefined),
          ...(opciones.credential ?? {}),
        };
  const user = opciones.user === null ? null : { id: '5', tenantId: '1', status: 'active', ...(opciones.user ?? {}) };
  const repository = {
    findUserById: jest.fn(async (_tenantId: unknown, id: unknown) => (user === null ? null : { ...user, id: String(id) })),
    buildAccessProfile: jest.fn(async (u: { id: string }) => ({ user: { id: u.id, roles: roles(u.id) } })),
    createAudit: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const credentials = { findOne: jest.fn(async (..._args: unknown[]) => credential) };
  const service = new InternalUserLockService(repository as never, credentials as never);
  return { service, repository, credentials, credential };
}

describe('InternalUserLockService', () => {
  it('lockState: bloqueo vigente, vencido y sin credencial', async () => {
    const vigente = montar();
    await expect(vigente.service.lockState('5', AHORA)).resolves.toEqual({
      locked: true,
      lockedUntil: FUTURO.toISOString(),
      failedLoginAttempts: 3,
    });
    expect(vigente.credentials.findOne).toHaveBeenCalledWith({ where: { actorType: 'internal_user', actorId: '5', deleted: false } });

    const vencido = montar({ credential: { lockedUntil: PASADO, failedLoginAttempts: 0 } });
    await expect(vencido.service.lockState('5', AHORA)).resolves.toMatchObject({ locked: false, lockedUntil: PASADO.toISOString() });

    const sinCredencial = montar({ credential: null });
    await expect(sinCredencial.service.lockState('5', AHORA)).resolves.toEqual({
      locked: false,
      lockedUntil: null,
      failedLoginAttempts: 0,
    });
  });

  it('withLockState añade `lock` al perfil sin tocar el resto', async () => {
    const { service } = montar({ credential: { lockedUntil: null, failedLoginAttempts: 1 } });
    const perfil = { user: { id: '5', email: 'a@b.c' } } as never;
    await expect(service.withLockState(perfil)).resolves.toEqual({
      user: { id: '5', email: 'a@b.c' },
      lock: { locked: false, lockedUntil: null, failedLoginAttempts: 1 },
    });
  });

  it('unlock limpia locked_until y el contador, y audita con motivo y lo que había', async () => {
    const { service, repository, credential } = montar();
    const result = await service.unlock(actor, '5', { reason: 'Olvidó la contraseña nueva' }, red, AHORA);

    expect(credential!.lockedUntil).toBeNull();
    expect(credential!.failedLoginAttempts).toBe(0);
    expect(credential!.updatedAtValue).toBe(AHORA);
    expect(credential!.save).toHaveBeenCalledTimes(1);
    expect(repository.findUserById).toHaveBeenCalledWith('1', '5');
    expect(repository.createAudit).toHaveBeenCalledWith({
      tenantId: '1',
      actorInternalUserId: '10',
      actionCode: 'internal_users.unlock',
      targetType: 'internal_user',
      targetId: '5',
      reason: 'Olvidó la contraseña nueva',
      metadata: { previousLockedUntil: FUTURO.toISOString(), previousFailedLoginAttempts: 3 },
      ipAddress: '1.1.1.1',
      userAgent: 'jest',
    });
    expect(result).toEqual({
      user: { id: '5', roles: ['SUPPORT_AGENT'] },
      lock: { locked: false, lockedUntil: null, failedLoginAttempts: 0 },
    });
  });

  it('unlock responde 409 si el bloqueo ya venció, si no hay bloqueo o si no hay credencial, sin escribir nada', async () => {
    for (const credential of [{ lockedUntil: PASADO }, { lockedUntil: null }, null]) {
      const { service, repository } = montar({ credential });
      await expect(service.unlock(actor, '5', { reason: 'motivo suficiente' }, red, AHORA)).rejects.toBeInstanceOf(ConflictException);
      expect(repository.createAudit).not.toHaveBeenCalled();
    }
  });

  it('unlock de una cuenta con rol privilegiado exige SUPER_ADMIN y no escribe nada si el actor no lo es', async () => {
    const { service, credential, repository } = montar({ roles: (id) => (id === '5' ? ['SUPER_ADMIN'] : ['INTERNAL_IDENTITY_ADMIN']) });
    await expect(service.unlock(actor, '5', { reason: 'motivo suficiente' }, red, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(credential?.save).not.toHaveBeenCalled();
    expect(repository.createAudit).not.toHaveBeenCalled();

    const conSuper = montar({ roles: () => ['SUPER_ADMIN'] });
    await conSuper.service.unlock(actor, '5', { reason: 'motivo suficiente' }, red, AHORA);
    expect(conSuper.credential?.save).toHaveBeenCalled();
  });

  it('unlock responde 404 si el usuario no es del tenant del actor', async () => {
    const { service, credentials } = montar({ user: null });
    await expect(service.unlock(actor, '5', { reason: 'motivo suficiente' }, red, AHORA)).rejects.toBeInstanceOf(NotFoundException);
    expect(credentials.findOne).not.toHaveBeenCalled();
  });

  it('unlock exige una sesión interna', async () => {
    const { service } = montar();
    await expect(
      service.unlock({ sub: '1', role: 'customer' } as never, '5', { reason: 'motivo suficiente' }, red, AHORA),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
