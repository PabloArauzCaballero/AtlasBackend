import { describe, expect, it, jest } from '@jest/globals';
import { AuthCredentialRepository } from '../../../src/modules/auth/auth-credential.repository.js';

/** Cobertura directa de `AuthCredentialRepository`: credenciales, lockout por fuerza bruta y último acceso. */
describe('AuthCredentialRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() });
    const models = { credential: make(), internalUser: make() };
    const repo = new AuthCredentialRepository(models.credential as never, models.internalUser as never);
    return { repo, models };
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
});
