import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { AuthOneTimeCodeRepository } from '../../../src/modules/auth/auth-one-time-code.repository.js';

/**
 * Cobertura directa de `AuthOneTimeCodeRepository`. Los códigos de un solo uso son una tabla con ciclo
 * de vida propio; sus reglas no tienen nada que ver con credenciales ni refresh tokens.
 */
describe('AuthOneTimeCodeRepository', () => {
  function buildOneTimeCodeRepo() {
    const oneTimeCode = { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() };
    return { repo: new AuthOneTimeCodeRepository(oneTimeCode as never), models: { oneTimeCode } };
  }

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

  describe('consulta y consumo', () => {
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
  });
});
