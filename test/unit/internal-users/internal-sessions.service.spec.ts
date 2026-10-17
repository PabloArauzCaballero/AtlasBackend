import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { InternalSessionsService } from '../../../src/modules/internal-users/internal-sessions.service.js';

/**
 * Sesiones abiertas del personal, sin tocar la base. Lo que se fija es lo que sale mal en silencio:
 * cerrar sesiones sin subir `token_version` (el access token seguiría vivo una hora), sin auditoría, sobre
 * uno mismo, o sobre una cuenta privilegiada sin ser SUPER_ADMIN; y rotular «activa ahora» una pestaña
 * que lleva horas sin renovarse.
 */
const AHORA = new Date('2026-10-17T12:00:00.000Z');
const actor = { sub: '10', tenantId: '1', internalUserId: '10', role: 'admin' as const };
const red = { ipAddress: '1.1.1.1', userAgent: 'jest' };

function montar(opciones: { user?: Record<string, unknown> | null; roles?: (id: string) => string[]; revoked?: number } = {}) {
  const roles = opciones.roles ?? ((id: string) => (id === '10' ? ['SUPER_ADMIN'] : ['SUPPORT_AGENT']));
  const user = opciones.user === null ? null : { id: '5', tenantId: '1', status: 'active', ...(opciones.user ?? {}) };
  const rbac = {
    findUserById: jest.fn(async (_tenantId: unknown, id: unknown) => (user === null ? null : { ...user, id: String(id) })),
    buildAccessProfile: jest.fn(async (u: { id: string }) => ({ user: { id: u.id, roles: roles(u.id) } })),
    createAudit: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const sessions = {
    listOpenSessions: jest.fn(async (..._args: unknown[]) => ({
      rows: [
        {
          sessionId: '91',
          internalUserId: '5',
          fullName: 'Ana Pérez',
          email: 'ana@atlas.test',
          status: 'active',
          lastLoginAt: new Date('2026-10-17T08:00:00.000Z'),
          renewedAt: new Date('2026-10-17T11:30:00.000Z'),
          expiresAt: new Date('2026-10-24T08:00:00.000Z'),
          ipAddress: '10.0.0.1',
          userAgent: 'Mozilla/5.0',
        },
        {
          sessionId: '90',
          internalUserId: '6',
          fullName: null,
          email: 'beto@atlas.test',
          status: 'active',
          lastLoginAt: null,
          renewedAt: new Date('2026-10-17T10:59:59.000Z'),
          expiresAt: new Date('2026-10-20T08:00:00.000Z'),
          ipAddress: null,
          userAgent: null,
        },
      ],
      total: 2,
      people: 2,
    })),
    revokeOpenSessions: jest.fn(async (..._args: unknown[]) => opciones.revoked ?? 2),
  };
  const tokens = { bumpTokenVersionIfPresent: jest.fn(async (..._args: unknown[]) => 4) };
  const service = new InternalSessionsService(sessions as never, rbac as never, tokens as never);
  return { service, rbac, sessions, tokens };
}

describe('InternalSessionsService.listOpenSessions', () => {
  it('lista las sesiones del tenant del actor con la página pedida y su resumen', async () => {
    const { service, sessions } = montar();
    const result = await service.listOpenSessions(actor, { page: 2, limit: 10 }, AHORA);

    expect(sessions.listOpenSessions).toHaveBeenCalledWith('1', { page: 2, limit: 10 }, AHORA);
    expect(result.meta).toMatchObject({ page: 2, limit: 10, total: 2 });
    expect(result.summary).toEqual({ openSessions: 2, people: 2, activeWindowMinutes: 60 });
    expect(result.items[0]).toEqual({
      sessionId: '91',
      internalUserId: '5',
      fullName: 'Ana Pérez',
      email: 'ana@atlas.test',
      status: 'active',
      lastLoginAt: '2026-10-17T08:00:00.000Z',
      renewedAt: '2026-10-17T11:30:00.000Z',
      expiresAt: '2026-10-24T08:00:00.000Z',
      activeNow: true,
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('una sesión renovada hace más de una hora no está «activa ahora»', async () => {
    const { service } = montar();
    const result = await service.listOpenSessions(actor, { page: 1, limit: 50 }, AHORA);
    expect(result.items[1]).toMatchObject({ sessionId: '90', activeNow: false, lastLoginAt: null });
  });

  it('rechaza a quien no es un actor interno', async () => {
    const { service, sessions } = montar();
    await expect(service.listOpenSessions({ sub: '3', role: 'customer' } as never, { page: 1, limit: 50 }, AHORA)).rejects.toThrow();
    expect(sessions.listOpenSessions).not.toHaveBeenCalled();
  });
});

describe('InternalSessionsService.revokeSessions', () => {
  it('revoca los tokens, sube token_version y audita con motivo y cuántas había', async () => {
    const { service, sessions, tokens, rbac } = montar({ revoked: 3 });
    const result = await service.revokeSessions(actor, '5', { reason: 'Equipo extraviado' }, red, AHORA);

    expect(result).toEqual({ internalUserId: '5', revokedSessions: 3 });
    expect(sessions.revokeOpenSessions).toHaveBeenCalledWith('5', 'admin_revoked', AHORA);
    expect(tokens.bumpTokenVersionIfPresent).toHaveBeenCalledWith('internal_user', '5');
    expect(rbac.createAudit).toHaveBeenCalledWith({
      tenantId: '1',
      actorInternalUserId: '10',
      actionCode: 'internal_users.sessions.revoke',
      targetType: 'internal_user',
      targetId: '5',
      reason: 'Equipo extraviado',
      metadata: { revokedSessions: 3 },
      ipAddress: '1.1.1.1',
      userAgent: 'jest',
    });
  });

  it('sin sesiones abiertas igual sube token_version y audita cero', async () => {
    const { service, tokens, rbac } = montar({ revoked: 0 });
    await expect(service.revokeSessions(actor, '5', { reason: 'Revisión trimestral' }, red, AHORA)).resolves.toEqual({
      internalUserId: '5',
      revokedSessions: 0,
    });
    expect(tokens.bumpTokenVersionIfPresent).toHaveBeenCalledTimes(1);
    expect(rbac.createAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { revokedSessions: 0 } }));
  });

  it('404 si la persona no existe en el tenant, sin revocar nada', async () => {
    const { service, sessions, tokens } = montar({ user: null });
    await expect(service.revokeSessions(actor, '5', { reason: 'Equipo extraviado' }, red, AHORA)).rejects.toBeInstanceOf(NotFoundException);
    expect(sessions.revokeOpenSessions).not.toHaveBeenCalled();
    expect(tokens.bumpTokenVersionIfPresent).not.toHaveBeenCalled();
  });

  it('403 sobre uno mismo', async () => {
    const { service, sessions } = montar();
    await expect(service.revokeSessions(actor, '10', { reason: 'Equipo extraviado' }, red, AHORA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(sessions.revokeOpenSessions).not.toHaveBeenCalled();
  });

  it('403 sobre una cuenta privilegiada si quien cierra no es SUPER_ADMIN', async () => {
    const { service, sessions, rbac } = montar({ roles: (id) => (id === '10' ? ['INTERNAL_IDENTITY_ADMIN'] : ['SYSTEMS_ADMIN']) });
    await expect(service.revokeSessions(actor, '5', { reason: 'Equipo extraviado' }, red, AHORA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(sessions.revokeOpenSessions).not.toHaveBeenCalled();
    expect(rbac.createAudit).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN sí puede cerrar las de una cuenta privilegiada', async () => {
    const { service } = montar({ roles: (id) => (id === '10' ? ['SUPER_ADMIN'] : ['SYSTEMS_ADMIN']) });
    await expect(service.revokeSessions(actor, '5', { reason: 'Equipo extraviado' }, red, AHORA)).resolves.toMatchObject({
      revokedSessions: 2,
    });
  });
});
