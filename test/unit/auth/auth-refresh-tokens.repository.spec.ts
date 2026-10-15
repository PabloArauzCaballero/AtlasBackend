import { describe, expect, it, jest } from '@jest/globals';
import { AuthRefreshTokensRepository } from '../../../src/modules/auth/auth-refresh-tokens.repository.js';

/** Cobertura directa de `AuthRefreshTokensRepository`: alta, rotación con FOR UPDATE, revocación en cadena y rastro de reuso. */
describe('AuthRefreshTokensRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() });
    const models = { refreshToken: make(), auditLog: make() };
    const sequelize = { query: jest.fn() };
    const repo = new AuthRefreshTokensRepository(models.refreshToken as never, models.auditLog as never, sequelize as never);
    return { repo, models, sequelize };
  }

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

  describe('auditoría de reuso', () => {
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
  });

  describe('lecturas y revocación total', () => {
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
