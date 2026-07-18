import { describe, expect, it, jest } from '@jest/globals';
import { NotificationPreferencesRepository } from '../../../src/modules/notifications/notification-preferences.repository.js';

/**
 * Cobertura directa de `NotificationPreferencesRepository` (Fase 1.2/2.3 del plan 10/10): la regla de
 * negocio de que una notificación `isRequired` no se puede desactivar, el merge de isRequired en el
 * upsert, y el default opt-out (sin preferencia ⇒ canal habilitado). Modelo Sequelize mockeado.
 */
describe('NotificationPreferencesRepository', () => {
  function buildRepo() {
    const preferenceModel = { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() };
    const repo = new NotificationPreferencesRepository(preferenceModel as never);
    return { repo, preferenceModel };
  }

  it('getPreferences filtra por tenant+cliente y ordena por eventCode/channel', async () => {
    const { repo, preferenceModel } = buildRepo();
    (preferenceModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.getPreferences('t1', 'c1');
    const arg = (preferenceModel.findAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; order: unknown };
    expect(arg.where).toEqual({ tenantId: 't1', customerId: 'c1' });
    expect(arg.order).toEqual([
      ['eventCode', 'ASC'],
      ['channel', 'ASC'],
    ]);
  });

  it('upsertPreferences lanza si se intenta desactivar una notificación requerida', async () => {
    const { repo, preferenceModel } = buildRepo();
    (preferenceModel.findOne as jest.Mock).mockResolvedValue({ isRequired: true } as never);
    await expect(
      repo.upsertPreferences('t1', 'c1', { preferences: [{ eventCode: 'e', channel: 'push', isEnabled: false, isRequired: false }] } as never),
    ).rejects.toThrow('REQUIRED_NOTIFICATION_CANNOT_BE_DISABLED');
  });

  it('upsertPreferences actualiza la preferencia existente y hace merge de isRequired (OR)', async () => {
    const { repo, preferenceModel } = buildRepo();
    const save = jest.fn(async () => ({}));
    const existing = { isRequired: true, isEnabled: true, save } as never;
    (preferenceModel.findOne as jest.Mock).mockResolvedValue(existing as never);
    (preferenceModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.upsertPreferences('t1', 'c1', { preferences: [{ eventCode: 'e', channel: 'push', isEnabled: true, isRequired: false }] } as never);
    expect((existing as { isRequired: boolean }).isRequired).toBe(true); // true || false
    expect(save).toHaveBeenCalled();
    expect(preferenceModel.create).not.toHaveBeenCalled();
  });

  it('upsertPreferences crea la preferencia cuando no existe', async () => {
    const { repo, preferenceModel } = buildRepo();
    (preferenceModel.findOne as jest.Mock).mockResolvedValue(null as never);
    (preferenceModel.create as jest.Mock).mockResolvedValue({} as never);
    (preferenceModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.upsertPreferences('t1', 'c1', { preferences: [{ eventCode: 'e', channel: 'sms', isEnabled: true, isRequired: false }] } as never);
    expect((preferenceModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ eventCode: 'e', channel: 'sms', isEnabled: true });
  });

  it('isChannelEnabled devuelve true de inmediato si required=true (sin consultar)', async () => {
    const { repo, preferenceModel } = buildRepo();
    const result = await repo.isChannelEnabled({ tenantId: 't1', customerId: 'c1', eventCode: 'e', channel: 'push' as never, required: true });
    expect(result).toBe(true);
    expect(preferenceModel.findOne).not.toHaveBeenCalled();
  });

  it('isChannelEnabled con opt-out: sin preferencia el canal se considera habilitado', async () => {
    const { repo, preferenceModel } = buildRepo();
    (preferenceModel.findOne as jest.Mock).mockResolvedValue(null as never);
    const result = await repo.isChannelEnabled({ tenantId: 't1', customerId: 'c1', eventCode: 'e', channel: 'push' as never });
    expect(result).toBe(true);
  });

  it('isChannelEnabled respeta isEnabled=false cuando existe preferencia no requerida', async () => {
    const { repo, preferenceModel } = buildRepo();
    (preferenceModel.findOne as jest.Mock).mockResolvedValue({ isRequired: false, isEnabled: false } as never);
    const result = await repo.isChannelEnabled({ tenantId: 't1', customerId: 'c1', eventCode: 'e', channel: 'push' as never });
    expect(result).toBe(false);
  });
});
