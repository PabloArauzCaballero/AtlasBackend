import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
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
    // El contador era un leer-sumar-guardar sobre la instancia: N logins en paralelo leían k y
    // escribían k+1. Lo que se fija aquí es que el incremento y el bloqueo salen en UN UPDATE
    // condicionado (expresiones SQL, no valores calculados en memoria) y que no toca una fila bloqueada.
    it('reserveLoginAttempt suma el intento en un único UPDATE condicionado a que no haya bloqueo vigente', async () => {
      const { repo, models } = buildRepo();
      models.credential.update.mockResolvedValue([1] as never);

      await expect(repo.reserveLoginAttempt('7', { maxAttempts: 5, lockoutMinutes: 15 })).resolves.toBeNull();

      expect(models.credential.update).toHaveBeenCalledTimes(1);
      const [values, options] = models.credential.update.mock.calls[0] as [
        { failedLoginAttempts: { val: string }; lockedUntil: { val: string } },
        { where: Record<string | symbol, unknown> },
      ];
      expect(values.failedLoginAttempts.val).toBe('CASE WHEN "failed_login_attempts" + 1 >= 5 THEN 0 ELSE "failed_login_attempts" + 1 END');
      expect(values.lockedUntil.val).toMatch(
        /^CASE WHEN "failed_login_attempts" \+ 1 >= 5 THEN '\d{4}-\d\d-\d\dT[\d:.]+Z'::timestamptz ELSE NULL END$/,
      );
      expect(options.where.id).toBe('7');
      expect(Object.getOwnPropertySymbols(options.where)).toHaveLength(1);
      expect(models.credential.findOne).not.toHaveBeenCalled();
    });

    it('reserveLoginAttempt no reserva sobre una cuenta bloqueada y devuelve hasta cuándo', async () => {
      const { repo, models } = buildRepo();
      const lockedUntil = new Date(Date.now() + 60_000);
      models.credential.update.mockResolvedValue([0] as never);
      models.credential.findOne.mockResolvedValue({ lockedUntil } as never);

      await expect(repo.reserveLoginAttempt('7', { maxAttempts: 5, lockoutMinutes: 15 })).resolves.toEqual({ lockedUntil });
    });

    it('clearFailedAttempts pone el contador a cero y levanta el bloqueo sin pasar por la instancia leída', async () => {
      const { repo, models } = buildRepo();
      await repo.clearFailedAttempts('7');
      expect(models.credential.update).toHaveBeenCalledWith(expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: null }), {
        where: { id: '7' },
      });
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

    it('reserveOneTimeCodeAttempt suma en SQL y sólo si quedan intentos y el código sigue vivo', async () => {
      const { repo, models } = buildOneTimeCodeRepo();
      (models.oneTimeCode.update as jest.Mock).mockResolvedValueOnce([1] as never).mockResolvedValueOnce([0] as never);
      await expect(repo.reserveOneTimeCodeAttempt({ id: 'otc1' } as never, 5)).resolves.toBe(true);
      await expect(repo.reserveOneTimeCodeAttempt({ id: 'otc1' } as never, 5)).resolves.toBe(false);
      const [values, options] = (models.oneTimeCode.update as jest.Mock).mock.calls[0] as [
        Record<string, unknown>,
        { where: Record<string, unknown> },
      ];
      // `attempts = attempts + 1` en la base, no el valor leído + 1: N peticiones en paralelo suman N.
      expect(String((values.attempts as { val: string }).val)).toBe('"attempts" + 1');
      expect(options.where).toMatchObject({ id: 'otc1', consumedAt: null });
      expect((options.where.attempts as Record<symbol, number>)[Op.lt]).toBe(5);
    });

    it('registerOneTimeCodeFailedAttempt consume el código sólo si con ese intento se agotaron', async () => {
      const { repo, models } = buildOneTimeCodeRepo();
      (models.oneTimeCode.update as jest.Mock).mockResolvedValue([1] as never);
      await repo.registerOneTimeCodeFailedAttempt({ id: 'otc1' } as never, 5);
      const [values, options] = (models.oneTimeCode.update as jest.Mock).mock.calls[0] as [
        Record<string, unknown>,
        { where: Record<string, unknown> },
      ];
      expect(values.consumedAt).toBeInstanceOf(Date);
      expect(options.where).toMatchObject({ id: 'otc1', consumedAt: null });
      expect((options.where.attempts as Record<symbol, number>)[Op.gte]).toBe(5);
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
        sessionStartedAt: new Date('2026-10-10T08:00:00Z'),
        userAgent: null,
        ipAddress: null,
      });
      const [values] = (models.refreshToken.create as jest.Mock).mock.calls[0];
      expect(values).toMatchObject({ tokenHash: 'th', revokedAt: null, replacedByTokenId: null });
      // El inicio de sesión de la familia se guarda tal cual: es lo que mide el tope absoluto del cliente.
      expect(values).toMatchObject({ sessionStartedAt: new Date('2026-10-10T08:00:00Z') });
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

    it('consumeOneTimeCode consume sólo un código vivo y dice si fue él quien lo consumió', async () => {
      const { repo, models } = buildOneTimeCodeRepo();
      (models.oneTimeCode.update as jest.Mock).mockResolvedValueOnce([1] as never).mockResolvedValueOnce([0] as never);
      await expect(repo.consumeOneTimeCode({ id: 'otc1' } as never)).resolves.toBe(true);
      await expect(repo.consumeOneTimeCode({ id: 'otc1' } as never)).resolves.toBe(false);
      const [values, options] = (models.oneTimeCode.update as jest.Mock).mock.calls[0] as [
        Record<string, unknown>,
        { where: Record<string, unknown> },
      ];
      expect(values.consumedAt).toBeInstanceOf(Date);
      expect(options.where).toEqual({ id: 'otc1', consumedAt: null });
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
