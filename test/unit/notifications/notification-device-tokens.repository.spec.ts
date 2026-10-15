import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { NotFoundException } from '@nestjs/common';
import { NotificationDeviceTokensRepository } from '../../../src/modules/notifications/notification-device-tokens.repository.js';
import { encryptSecretEnvelope } from '../../../src/common/utils/crypto/envelope-encryption.util.js';

/** Cifrado y upsert de dispositivos push, y resolución de contactos del cliente. */
describe('NotificationDeviceTokensRepository', () => {
  function build() {
    const deviceTokenModel = {
      update: jest.fn(async (..._args: unknown[]) => [0]),
      findOne: jest.fn(),
      create: jest.fn(async (v: unknown) => ({ id: 'dt1', ...(v as object) })),
      findAll: jest.fn(async (..._args: unknown[]) => []),
    };
    const contactMethodModel = { findAll: jest.fn(async (..._args: unknown[]) => []) };
    const repo = new NotificationDeviceTokensRepository(deviceTokenModel as never, contactMethodModel as never);
    return { repo, deviceTokenModel, contactMethodModel };
  }

  describe('upsertDeviceToken', () => {
    it('reactiva y re-cifra un token existente en vez de crear otro', async () => {
      const { repo, deviceTokenModel } = build();
      const existing = { isActive: false, save: jest.fn(async (..._args: unknown[]) => undefined) };
      (deviceTokenModel.findOne as jest.Mock).mockResolvedValueOnce(existing as never);
      await repo.upsertDeviceToken('t1', 'c1', { token: 'tok-123', platform: 'ios', deviceId: 'd1' } as never);
      expect((existing as { isActive: boolean }).isActive).toBe(true);
      expect(existing.save).toHaveBeenCalled();
      expect(deviceTokenModel.create).not.toHaveBeenCalled();
    });

    it('crea un token nuevo (cifrado + last4) cuando no existe', async () => {
      const { repo, deviceTokenModel } = build();
      (deviceTokenModel.findOne as jest.Mock).mockResolvedValueOnce(null as never);
      await repo.upsertDeviceToken('t1', 'c1', { token: 'token-abcd', platform: 'android' } as never);
      const created = (deviceTokenModel.create as jest.Mock).mock.calls[0][0] as { tokenLast4: string; isActive: boolean };
      expect(created.isActive).toBe(true);
      expect(created.tokenLast4).toBe('abcd');
    });
  });

  it('upsertDeviceToken apaga el mismo token en los OTROS clientes del tenant antes de dejarlo activo aquí', async () => {
    const { repo, deviceTokenModel } = build();
    (deviceTokenModel.findOne as jest.Mock).mockResolvedValueOnce(null as never);
    await repo.upsertDeviceToken('t1', 'c2', { token: 'telefono-compartido', platform: 'android' } as never);
    const [values, options] = (deviceTokenModel.update as jest.Mock).mock.calls[0] as [
      Record<string, unknown>,
      { where: Record<string, unknown> },
    ];
    expect(values).toMatchObject({ isActive: false });
    expect(options.where).toMatchObject({ tenantId: 't1', isActive: true, customerId: { [Op.ne]: 'c2' } });
    const created = (deviceTokenModel.create as jest.Mock).mock.calls[0][0] as { tokenHash: string };
    expect(options.where.tokenHash).toBe(created.tokenHash);
  });

  describe('getCustomerContactTargets', () => {
    it('devuelve [] sin tenant o para un canal sin tipo de contacto (push)', async () => {
      const { repo } = build();
      expect(await repo.getCustomerContactTargets(null, 'c1', 'email')).toEqual([]);
      expect(await repo.getCustomerContactTargets('t1', 'c1', 'push')).toEqual([]);
    });

    it('resuelve y deduplica los contactos descifrados del cliente', async () => {
      const { repo, contactMethodModel } = build();
      const enc = await encryptSecretEnvelope('a@x.com');
      (contactMethodModel.findAll as jest.Mock).mockResolvedValueOnce([
        { contactValueEncrypted: enc },
        { contactValueEncrypted: enc }, // mismo valor -> se deduplica
      ] as never);
      const targets = await repo.getCustomerContactTargets('t1', 'c1', 'email');
      expect(targets).toEqual([{ kind: 'email', address: 'a@x.com' }]);
    });
  });

  it('getActivePushDevices descifra, deduplica y CONSERVA la plataforma', async () => {
    // La plataforma es lo que decide si el aviso sale por APNs o por FCM: perderla dejaba sin avisos
    // a todos los iPhone, porque su token lo emite Apple y Firebase siempre lo rechaza.
    const { repo, deviceTokenModel } = build();
    const enc = await encryptSecretEnvelope('device-token-xyz');
    const otro = await encryptSecretEnvelope('token-de-iphone');
    (deviceTokenModel.findAll as jest.Mock).mockResolvedValueOnce([
      { tokenEncrypted: enc, platform: 'android' },
      { tokenEncrypted: enc, platform: 'android' },
      { tokenEncrypted: otro, platform: 'ios' },
    ] as never);
    expect(await repo.getActivePushDevices('t1', 'c1')).toEqual([
      { token: 'device-token-xyz', platform: 'android' },
      { token: 'token-de-iphone', platform: 'ios' },
    ]);
    expect(await repo.getActivePushDevices(null, 'c1')).toEqual([]);
  });

  it('deactivateDeviceToken lanza NotFound o desactiva y guarda', async () => {
    const { repo, deviceTokenModel } = build();
    (deviceTokenModel.findOne as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(repo.deactivateDeviceToken('t1', 'c1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    const token = { isActive: true, save: jest.fn(async (..._args: unknown[]) => undefined) };
    (deviceTokenModel.findOne as jest.Mock).mockResolvedValueOnce(token as never);
    await repo.deactivateDeviceToken('t1', 'c1', 'dt1');
    expect((token as { isActive: boolean }).isActive).toBe(false);
    expect(token.save).toHaveBeenCalled();
  });

  describe('contactos de sms y whatsapp', () => {
    it('getCustomerContactTargets soporta sms/whatsapp y descarta lo que no se puede descifrar', async () => {
      const { repo, contactMethodModel } = build();
      (contactMethodModel.findAll as jest.Mock).mockResolvedValue([{ contactValueEncrypted: 'basura-no-descifrable' }] as never);
      expect(await repo.getCustomerContactTargets('t1', 'c1', 'sms')).toEqual([]);
      expect(((contactMethodModel.findAll as jest.Mock).mock.calls[0][0] as Record<string, unknown>).where).toMatchObject({
        contactType: 'phone',
      });

      await repo.getCustomerContactTargets('t1', 'c1', 'whatsapp');
      expect(((contactMethodModel.findAll as jest.Mock).mock.calls[1][0] as Record<string, unknown>).where).toMatchObject({
        contactType: 'phone',
      });
    });
  });

  it('upsertDeviceToken conserva el deviceId previo cuando el body no lo trae', async () => {
    const { repo, deviceTokenModel } = build();
    const existing = { deviceId: 'dispositivo-previo', save: jest.fn(async (..._args: unknown[]) => undefined) };
    (deviceTokenModel.findOne as jest.Mock).mockResolvedValueOnce(existing as never);
    await repo.upsertDeviceToken('t1', 'c1', { token: 'tok', platform: 'ios' } as never);
    expect((existing as { deviceId: string }).deviceId).toBe('dispositivo-previo');
  });
});
