import { describe, expect, it, jest } from '@jest/globals';
import { SessionsDeviceRepository } from '../../../src/modules/sessions/repositories/sessions-device.repository.js';

/**
 * Cobertura directa de `SessionsDeviceRepository` (Fase 1.2 del plan 10/10): el registro de
 * dispositivos (global y por tenant) y sus enlaces con el cliente. Es un sub-repo con lógica real
 * (defaults de alta, incremento del contador de reuso). Modelos Sequelize mockeados.
 */
describe('SessionsDeviceRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), create: jest.fn() });
    const models = {
      globalDevice: make(),
      device: make(),
      customerDeviceLink: make(),
      deviceSnapshot: make(),
      deviceRiskEvent: make(),
    };
    const repo = new SessionsDeviceRepository(
      models.globalDevice as never,
      models.device as never,
      models.customerDeviceLink as never,
      models.deviceSnapshot as never,
      models.deviceRiskEvent as never,
    );
    return { repo, models };
  }

  const opts = { transaction: 'tx' as never };

  it('findGlobalDevice busca por fingerprint + versión', async () => {
    const { repo, models } = buildRepo();
    (models.globalDevice.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findGlobalDevice('fp', 'v1', opts);
    expect((models.globalDevice.findOne as jest.Mock).mock.calls[0][0].where).toMatchObject({ deviceFingerprint: 'fp', fingerprintVersion: 'v1' });
  });

  it('createGlobalDevice nace con reuseCount=1 y riesgo unknown', async () => {
    const { repo, models } = buildRepo();
    (models.globalDevice.create as jest.Mock).mockResolvedValue({ id: 'g1' } as never);
    await repo.createGlobalDevice({ deviceFingerprint: 'fp', fingerprintVersion: 'v1', now: new Date('2026-01-01') }, opts);
    expect((models.globalDevice.create as jest.Mock).mock.calls[0][0]).toMatchObject({ globalReuseCount: 1, globalRiskStatus: 'unknown' });
  });

  it('touchGlobalDevice incrementa el contador de reuso global y guarda', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => undefined);
    const device = { globalReuseCount: 4, save } as never;
    await repo.touchGlobalDevice(device, new Date('2026-01-02'), opts);
    expect((device as { globalReuseCount: number }).globalReuseCount).toBe(5);
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('findDevice / findDeviceById excluyen borrados', async () => {
    const { repo, models } = buildRepo();
    (models.device.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findDevice('t1', 'fp', 'v1', opts);
    await repo.findDeviceById('t1', 'd1');
    expect((models.device.findOne as jest.Mock).mock.calls[0][0].where.deleted).toBeDefined();
    expect((models.device.findOne as jest.Mock).mock.calls[1][0].where).toMatchObject({ tenantId: 't1', id: 'd1' });
  });

  it('createDevice nace con tenantReuseCount=1 y no borrado', async () => {
    const { repo, models } = buildRepo();
    (models.device.create as jest.Mock).mockResolvedValue({ id: 'd1' } as never);
    await repo.createDevice(
      { tenantId: 't1', globalDeviceFingerprintId: 'g1', deviceFingerprint: 'fp', fingerprintVersion: 'v1', now: new Date('2026-01-01') },
      opts,
    );
    expect((models.device.create as jest.Mock).mock.calls[0][0]).toMatchObject({ tenantReuseCount: 1, riskStatus: 'unknown', deleted: false });
  });

  it('touchDevice incrementa el contador de reuso por tenant', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => undefined);
    const device = { tenantReuseCount: 0, save } as never;
    await repo.touchDevice(device, new Date('2026-01-02'), opts);
    expect((device as { tenantReuseCount: number }).tenantReuseCount).toBe(1);
  });

  it('findCustomerDeviceLink filtra por tenant+cliente+dispositivo no borrado', async () => {
    const { repo, models } = buildRepo();
    (models.customerDeviceLink.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findCustomerDeviceLink('t1', 'c1', 'd1', opts);
    expect((models.customerDeviceLink.findOne as jest.Mock).mock.calls[0][0].where).toMatchObject({ tenantId: 't1', customerId: 'c1', deviceId: 'd1' });
  });
});
