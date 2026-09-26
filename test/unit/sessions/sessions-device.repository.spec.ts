import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { SessionsDeviceRepository } from '../../../src/modules/sessions/repositories/sessions-device.repository.js';

/**
 * Cobertura directa de `SessionsDeviceRepository` (Fase 1.2 del plan 10/10): el registro de
 * dispositivos (global y por tenant) y sus enlaces con el cliente. Es un sub-repo con lógica real
 * (defaults de alta, incremento del contador de reuso). Modelos Sequelize mockeados.
 */
describe('SessionsDeviceRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: asyncMock(), create: asyncMock(), findAll: asyncMock() });
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
    expect(callArg<CallArgRecord>(models.globalDevice.findOne, 0, 0).where).toMatchObject({
      deviceFingerprint: 'fp',
      fingerprintVersion: 'v1',
    });
  });

  it('createGlobalDevice nace con reuseCount=1 y riesgo unknown', async () => {
    const { repo, models } = buildRepo();
    (models.globalDevice.create as jest.Mock).mockResolvedValue({ id: 'g1' } as never);
    await repo.createGlobalDevice({ deviceFingerprint: 'fp', fingerprintVersion: 'v1', now: new Date('2026-01-01') }, opts);
    expect((models.globalDevice.create as jest.Mock).mock.calls[0][0]).toMatchObject({ globalReuseCount: 1, globalRiskStatus: 'unknown' });
  });

  it('touchGlobalDevice incrementa el contador de reuso global y guarda', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async (..._args: unknown[]) => undefined);
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
    expect(callArg<CallArgRecord>(models.device.findOne, 0, 0).where.deleted).toBeDefined();
    expect(callArg<CallArgRecord>(models.device.findOne, 1, 0).where).toMatchObject({ tenantId: 't1', id: 'd1' });
  });

  it('createDevice nace con tenantReuseCount=1 y no borrado', async () => {
    const { repo, models } = buildRepo();
    (models.device.create as jest.Mock).mockResolvedValue({ id: 'd1' } as never);
    await repo.createDevice(
      { tenantId: 't1', globalDeviceFingerprintId: 'g1', deviceFingerprint: 'fp', fingerprintVersion: 'v1', now: new Date('2026-01-01') },
      opts,
    );
    expect((models.device.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      tenantReuseCount: 1,
      riskStatus: 'unknown',
      deleted: false,
    });
  });

  it('touchDevice incrementa el contador de reuso por tenant', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async (..._args: unknown[]) => undefined);
    const device = { tenantReuseCount: 0, save } as never;
    await repo.touchDevice(device, new Date('2026-01-02'), opts);
    expect((device as { tenantReuseCount: number }).tenantReuseCount).toBe(1);
  });

  it('findCustomerDeviceLink filtra por tenant+cliente+dispositivo no borrado', async () => {
    const { repo, models } = buildRepo();
    (models.customerDeviceLink.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findCustomerDeviceLink('t1', 'c1', 'd1', opts);
    expect(callArg<CallArgRecord>(models.customerDeviceLink.findOne, 0, 0).where).toMatchObject({
      tenantId: 't1',
      customerId: 'c1',
      deviceId: 'd1',
    });
  });

  it('createCustomerDeviceLink nace activo, trust new y no borrado', async () => {
    const { repo, models } = buildRepo();
    (models.customerDeviceLink.create as jest.Mock).mockResolvedValue({ id: 'l1' } as never);
    await repo.createCustomerDeviceLink({ tenantId: 't1', customerId: 'c1', deviceId: 'd1', now: new Date('2026-01-01') }, opts);
    expect((models.customerDeviceLink.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      linkStatus: 'active',
      trustLevel: 'new',
      isPrimaryDevice: false,
      deleted: false,
    });
  });

  it('touchCustomerDeviceLink fija lastSeenSessionId y firstSeen solo si estaba null', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async (..._args: unknown[]) => undefined);
    const link = { firstSeenSessionId: null, save } as never;
    await repo.touchCustomerDeviceLink(link, 's1', new Date('2026-01-02'), opts);
    expect((link as { firstSeenSessionId: string; lastSeenSessionId: string }).firstSeenSessionId).toBe('s1');
    expect((link as { lastSeenSessionId: string }).lastSeenSessionId).toBe('s1');
    // segunda llamada: firstSeen ya no se toca
    (link as { firstSeenSessionId: string }).firstSeenSessionId = 's1';
    await repo.touchCustomerDeviceLink(link, 's2', new Date('2026-01-03'), opts);
    expect((link as { firstSeenSessionId: string }).firstSeenSessionId).toBe('s1');
    expect((link as { lastSeenSessionId: string }).lastSeenSessionId).toBe('s2');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('createDeviceSnapshot copia las señales de riesgo y capturedAt', async () => {
    const { repo, models } = buildRepo();
    (models.deviceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'sn1' } as never);
    await repo.createDeviceSnapshot(
      {
        tenantId: 't1',
        customerId: 'c1',
        deviceId: 'd1',
        sessionId: 's1',
        brand: 'Samsung',
        model: 'A54',
        osFamily: 'android',
        osVersion: '14',
        appVersion: '1.0',
        isRooted: false,
        isEmulator: false,
        vpnDetected: true,
        now: new Date('2026-01-01'),
      },
      opts,
    );
    expect((models.deviceSnapshot.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      brand: 'Samsung',
      vpnDetected: true,
      sessionId: 's1',
    });
  });

  it('findLatestDeviceSnapshot / findSessionDeviceSnapshots ordenan por capturedAt desc', async () => {
    const { repo, models } = buildRepo();
    (models.deviceSnapshot.findOne as jest.Mock).mockResolvedValue(null as never);
    (models.deviceSnapshot.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findLatestDeviceSnapshot('t1', 's1');
    expect((models.deviceSnapshot.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', sessionId: 's1' } });
    await repo.findSessionDeviceSnapshots('t1', 's1', 5);
    expect((models.deviceSnapshot.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', sessionId: 's1' },
      limit: 5,
    });
  });

  it('createDeviceRiskEvent mapea evidence a supportingEvidenceJson y happenedAt', async () => {
    const { repo, models } = buildRepo();
    (models.deviceRiskEvent.create as jest.Mock).mockResolvedValue({ id: 're1' } as never);
    const occurredAt = new Date('2026-01-05');
    await repo.createDeviceRiskEvent(
      { tenantId: 't1', deviceId: 'd1', eventType: 'root_detected', reasonCode: 'ROOT', evidence: { a: 1 }, occurredAt },
      opts,
    );
    expect((models.deviceRiskEvent.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      eventType: 'root_detected',
      reasonCode: 'ROOT',
      supportingEvidenceJson: { a: 1 },
      happenedAt: occurredAt,
    });
  });

  it('findDeviceRiskEvents filtra por tenant+device', async () => {
    const { repo, models } = buildRepo();
    (models.deviceRiskEvent.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findDeviceRiskEvents('t1', 'd1', 7);
    expect((models.deviceRiskEvent.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', deviceId: 'd1' },
      limit: 7,
    });
  });
});
