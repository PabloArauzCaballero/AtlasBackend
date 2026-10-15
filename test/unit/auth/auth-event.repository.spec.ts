import { describe, expect, it, jest } from '@jest/globals';
import { AuthEventRepository } from '../../../src/modules/auth/auth-event.repository.js';

/** Cobertura directa de `AuthEventRepository`: mapeo del actor en la auditoría y bitácora de clientes. */
describe('AuthEventRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() });
    const models = { authEvent: make(), auditLog: make() };
    const repo = new AuthEventRepository(models.authEvent as never, models.auditLog as never);
    return { repo, models };
  }

  describe('auditoría de autenticación', () => {
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
});
