import { describe, expect, it, jest } from '@jest/globals';
import { AuthOneTimeCodeRepository } from '../../../src/modules/auth/auth-one-time-code.repository.js';
import { AuthRepository } from '../../../src/modules/auth/auth.repository.js';

/**
 * Cobertura directa de `AuthRepository` (Fase 1.2 del plan 10/10). `auth` es el dominio crítico con
 * la cobertura más baja, y su repositorio no tenía spec propio: el `AuthService` lo mockea, así que
 * su lógica de persistencia (lockout, códigos de un solo uso, rotación/revocación de refresh tokens,
 * mapeo del actor en la auditoría) no se ejercitaba. Los modelos Sequelize y la conexión se mockean.
 */
describe('AuthRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() });
    const models = {
      credential: make(),
      refreshToken: make(),
      oneTimeCode: make(),
      internalUser: make(),
      platformUser: make(),
      authEvent: make(),
      auditLog: make(),
    };
    const sequelize = { query: jest.fn() };
    const repo = new AuthRepository(
      models.credential as never,
      models.refreshToken as never,
      models.internalUser as never,
      models.platformUser as never,
      models.authEvent as never,
      models.auditLog as never,
      sequelize as never,
    );
    return { repo, models, sequelize };
  }

  /**
   * Los códigos de un solo uso viven en su propio repositorio: son una tabla con ciclo de vida
   * propio y sus reglas no tienen nada que ver con credenciales ni refresh tokens.
   */
  function buildOneTimeCodeRepo() {
    const oneTimeCode = { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() };
    return { repo: new AuthOneTimeCodeRepository(oneTimeCode as never), models: { oneTimeCode } };
  }

  describe('credenciales', () => {
    it('findCredentialsByActor filtra por actor y no-borrado', async () => {
      const { repo, models } = buildRepo();
      (models.credential.findOne as jest.Mock).mockResolvedValue({ id: 'c1' } as never);
      const result = await repo.findCredentialsByActor('customer', '10');
      expect(result).toEqual({ id: 'c1' });
      expect((models.credential.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
        where: { actorType: 'customer', actorId: '10', deleted: false },
      });
    });

    it('createCredentials arranca tokenVersion=1 y sin bloqueo', async () => {
      const { repo, models } = buildRepo();
      (models.credential.create as jest.Mock).mockResolvedValue({ id: 'c1' } as never);
      await repo.createCredentials({ tenantId: '1', actorType: 'internal_user', actorId: '5', passwordHash: 'h' });
      const [values] = (models.credential.create as jest.Mock).mock.calls[0];
      expect(values).toMatchObject({ tokenVersion: 1, failedLoginAttempts: 0, lockedUntil: null, deleted: false });
    });

    it('updatePasswordHash resetea intentos y bloqueo', async () => {
      const { repo } = buildRepo();
      const save = jest.fn(async (..._args: unknown[]) => undefined);
      const credential = { failedLoginAttempts: 3, lockedUntil: new Date(), save } as never;
      await repo.updatePasswordHash(credential, 'newhash');
      expect((credential as { passwordHash: string }).passwordHash).toBe('newhash');
      expect((credential as { failedLoginAttempts: number }).failedLoginAttempts).toBe(0);
      expect((credential as { lockedUntil: null }).lockedUntil).toBeNull();
      expect(save).toHaveBeenCalled();
    });

    it('setMfaEnabled togglea el flag y guarda', async () => {
      const { repo } = buildRepo();
      const save = jest.fn(async (..._args: unknown[]) => undefined);
      const credential = { mfaEnabled: false, save } as never;
      await repo.setMfaEnabled(credential, true);
      expect((credential as { mfaEnabled: boolean }).mfaEnabled).toBe(true);
      expect(save).toHaveBeenCalled();
    });
  });

  describe('lockout por fuerza bruta', () => {
    it('recordFailedAttempt incrementa el contador sin bloquear si no llega al máximo', async () => {
      const { repo } = buildRepo();
      const save = jest.fn(async (..._args: unknown[]) => undefined);
      const credential = { failedLoginAttempts: 1, lockedUntil: null, save } as never;
      await repo.recordFailedAttempt(credential, { maxAttempts: 5, lockoutMinutes: 15 });
      expect((credential as { failedLoginAttempts: number }).failedLoginAttempts).toBe(2);
      expect((credential as { lockedUntil: Date | null }).lockedUntil).toBeNull();
    });

    it('recordFailedAttempt bloquea y resetea el contador al alcanzar el máximo', async () => {
      const { repo } = buildRepo();
      const save = jest.fn(async (..._args: unknown[]) => undefined);
      const credential = { failedLoginAttempts: 4, lockedUntil: null, save } as never;
      await repo.recordFailedAttempt(credential, { maxAttempts: 5, lockoutMinutes: 15 });
      expect((credential as { failedLoginAttempts: number }).failedLoginAttempts).toBe(0);
      expect((credential as { lockedUntil: Date | null }).lockedUntil).toBeInstanceOf(Date);
    });

    it('recordSuccessfulLogin limpia el bloqueo y, para internal_user, sella lastLoginAt en su tabla', async () => {
      const { repo, models } = buildRepo();
      const save = jest.fn(async (..._args: unknown[]) => undefined);
      const credential = { actorType: 'internal_user', actorId: '5', failedLoginAttempts: 2, save } as never;
      await repo.recordSuccessfulLogin(credential, '127.0.0.1');
      expect((credential as { failedLoginAttempts: number }).failedLoginAttempts).toBe(0);
      expect((credential as { lastLoginIp: string }).lastLoginIp).toBe('127.0.0.1');
      expect(models.internalUser.update).toHaveBeenCalledTimes(1);
    });

    it('recordSuccessfulLogin NO toca la tabla de internos cuando el actor es customer', async () => {
      const { repo, models } = buildRepo();
      const credential = { actorType: 'customer', actorId: '10', save: jest.fn(async (..._args: unknown[]) => undefined) } as never;
      await repo.recordSuccessfulLogin(credential, null);
      expect(models.internalUser.update).not.toHaveBeenCalled();
    });
  });

  describe('códigos de un solo uso', () => {
    it('createOneTimeCode consume cualquier código activo previo del mismo actor+propósito antes de crear', async () => {
      const { repo, models } = buildOneTimeCodeRepo();
      (models.oneTimeCode.create as jest.Mock).mockResolvedValue({ id: 'otc1' } as never);
      await repo.createOneTimeCode({
        tenantId: '1',
        actorType: 'customer',
        actorId: '10',
        purpose: 'password_reset',
        codeHash: 'ch',
        challengeHash: null,
        expiresAt: new Date(),
      });
      expect(models.oneTimeCode.update).toHaveBeenCalledTimes(1); // consume previos
      expect(models.oneTimeCode.create).toHaveBeenCalledTimes(1);
    });

    it('registerOneTimeCodeFailedAttempt consume el código al agotar los intentos', async () => {
      const { repo } = buildOneTimeCodeRepo();
      const save = jest.fn(async (..._args: unknown[]) => undefined);
      const code = { attempts: 4, consumedAt: null, save } as never;
      await repo.registerOneTimeCodeFailedAttempt(code, 5);
      expect((code as { attempts: number }).attempts).toBe(5);
      expect((code as { consumedAt: Date | null }).consumedAt).toBeInstanceOf(Date);
    });

    it('registerOneTimeCodeFailedAttempt solo incrementa si aún quedan intentos', async () => {
      const { repo } = buildOneTimeCodeRepo();
      const save = jest.fn(async (..._args: unknown[]) => undefined);
      const code = { attempts: 1, consumedAt: null, save } as never;
      await repo.registerOneTimeCodeFailedAttempt(code, 5);
      expect((code as { attempts: number }).attempts).toBe(2);
      expect((code as { consumedAt: Date | null }).consumedAt).toBeNull();
    });
  });

  describe('refresh tokens', () => {
    it('createRefreshToken nace activo (revokedAt null)', async () => {
      const { repo, models } = buildRepo();
      (models.refreshToken.create as jest.Mock).mockResolvedValue({ id: 'rt1' } as never);
      await repo.createRefreshToken({
        tenantId: '1',
        actorType: 'customer',
        actorId: '10',
        tokenHash: 'th',
        expiresAt: new Date(),
        userAgent: null,
        ipAddress: null,
      });
      const [values] = (models.refreshToken.create as jest.Mock).mock.calls[0];
      expect(values).toMatchObject({ tokenHash: 'th', revokedAt: null, replacedByTokenId: null });
    });

    it('findRefreshTokenForUpdate bloquea la fila con FOR UPDATE y no filtra por revokedAt', async () => {
      const { repo, models } = buildRepo();
      (models.refreshToken.findOne as jest.Mock).mockResolvedValue(null as never);
      await repo.findRefreshTokenForUpdate('th', 'tx' as never);
      const options = (models.refreshToken.findOne as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; lock: unknown };
      expect(options.where).toMatchObject({ tokenHash: 'th' });
      expect(options.where.revokedAt).toBeUndefined();
      expect(options.lock).toBeDefined();
    });

    it('revokeRefreshToken marca revocado con motivo y token de reemplazo', async () => {
      const { repo } = buildRepo();
      const save = jest.fn(async (..._args: unknown[]) => undefined);
      const token = { save } as never;
      await repo.revokeRefreshToken(token, 'rotated', 'rt2');
      expect((token as { revokedReason: string }).revokedReason).toBe('rotated');
      expect((token as { replacedByTokenId: string }).replacedByTokenId).toBe('rt2');
    });

    it('revokeDescendantChain corre la CTE recursiva y devuelve los ids revocados como strings', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock).mockResolvedValue([{ _id: 2 }, { _id: 3 }] as never);
      const result = await repo.revokeDescendantChain('1', 'tx' as never);
      expect(result).toEqual(['2', '3']);
      expect(sequelize.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('auditoría de autenticación', () => {
    it('recordRefreshReuseEvent mapea internal_user a su columna dedicada y cuenta descendientes', async () => {
      const { repo, models } = buildRepo();
      await repo.recordRefreshReuseEvent(
        { tenantId: '1', actorType: 'internal_user', actorId: '5', reusedTokenId: 'rt1', revokedDescendantIds: ['rt2', 'rt3'] },
        'tx' as never,
      );
      const [values] = (models.auditLog.create as jest.Mock).mock.calls[0];
      expect(values).toMatchObject({
        actionCode: 'auth.refresh_token.reuse_detected',
        actorInternalUserId: '5',
        actorPlatformUserId: null,
      });
      expect((values as { payloadJson: { revokedDescendantCount: number } }).payloadJson.revokedDescendantCount).toBe(2);
    });

    it('recordLoginAttemptEvent escribe en auth_events SOLO para clientes', async () => {
      const { repo, models } = buildRepo();
      await repo.recordLoginAttemptEvent({
        tenantId: '1',
        actorType: 'customer',
        actorId: '10',
        eventType: 'login',
        successful: true,
        failureReasonCode: null,
        ipAddress: null,
        userAgent: null,
      });
      expect(models.auditLog.create).toHaveBeenCalledTimes(1);
      expect(models.authEvent.create).toHaveBeenCalledTimes(1); // rama de cliente
    });

    it('recordLoginAttemptEvent de un internal_user NO escribe en auth_events y usa la columna interna', async () => {
      const { repo, models } = buildRepo();
      await repo.recordLoginAttemptEvent({
        tenantId: '1',
        actorType: 'internal_user',
        actorId: '5',
        eventType: 'login',
        successful: false,
        failureReasonCode: 'invalid_password',
        ipAddress: null,
        userAgent: null,
      });
      expect(models.authEvent.create).not.toHaveBeenCalled();
      const [values] = (models.auditLog.create as jest.Mock).mock.calls[0];
      expect(values).toMatchObject({ actionCode: 'auth.login.failure', actorInternalUserId: '5' });
    });
  });

  describe('finders y mutaciones restantes', () => {
    it('findInternalUserById / findPlatformUserById filtran por id', async () => {
      const { repo, models } = buildRepo();
      (models.internalUser.findOne as jest.Mock).mockResolvedValue({ id: '5' } as never);
      (models.platformUser.findOne as jest.Mock).mockResolvedValue(null as never);
      await repo.findInternalUserById('5');
      expect((models.internalUser.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { id: '5' } });
      await repo.findPlatformUserById('9');
      expect((models.platformUser.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { id: '9' } });
    });

    it('findActiveOneTimeCodeByChallenge exige challengeHash + no-consumido', async () => {
      const { repo, models } = buildOneTimeCodeRepo();
      (models.oneTimeCode.findOne as jest.Mock).mockResolvedValue(null as never);
      await repo.findActiveOneTimeCodeByChallenge('h');
      expect((models.oneTimeCode.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { challengeHash: 'h', consumedAt: null } });
    });

    it('consumeOneTimeCode marca consumedAt y guarda', async () => {
      const { repo } = buildOneTimeCodeRepo();
      const save = jest.fn(async (..._args: unknown[]) => undefined);
      const code = { consumedAt: null, save } as never;
      await repo.consumeOneTimeCode(code);
      expect((code as { consumedAt: Date | null }).consumedAt).not.toBeNull();
      expect(save).toHaveBeenCalled();
    });

    it('findActiveRefreshTokenByHash exige tokenHash + no-revocado', async () => {
      const { repo, models } = buildRepo();
      (models.refreshToken.findOne as jest.Mock).mockResolvedValue(null as never);
      await repo.findActiveRefreshTokenByHash('th');
      expect((models.refreshToken.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { tokenHash: 'th', revokedAt: null } });
    });

    it('revokeAllRefreshTokensForActor revoca todos los tokens activos del actor', async () => {
      const { repo, models } = buildRepo();
      (models.refreshToken.update as jest.Mock).mockResolvedValue([2] as never);
      await repo.revokeAllRefreshTokensForActor('internal_user', '5', 'password_reset');
      const [values, options] = (models.refreshToken.update as jest.Mock).mock.calls[0] as [
        Record<string, unknown>,
        { where: Record<string, unknown> },
      ];
      expect(values).toMatchObject({ revokedReason: 'password_reset' });
      expect(options.where).toMatchObject({ actorType: 'internal_user', actorId: '5', revokedAt: null });
    });
  });
});
