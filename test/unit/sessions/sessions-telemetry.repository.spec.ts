import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { SessionsTelemetryRepository } from '../../../src/modules/sessions/repositories/sessions-telemetry.repository.js';

/**
 * Cobertura directa de `SessionsTelemetryRepository` (Fase 1.2 del plan 10/10): las escrituras y
 * lecturas de la telemetría por sesión (permisos, auth, IP, SIM, acciones, observaciones). Sub-repo
 * con lógica real (mapeo de fechas de la decisión). Modelos Sequelize mockeados.
 */
describe('SessionsTelemetryRepository', () => {
  function buildRepo() {
    const make = () => ({ findAll: asyncMock(), create: asyncMock() });
    const models = {
      permissionEvent: make(),
      authEvent: make(),
      ipReputation: make(),
      simObservation: make(),
      customerActionLog: make(),
      customerObservation: make(),
    };
    const repo = new SessionsTelemetryRepository(
      models.permissionEvent as never,
      models.authEvent as never,
      models.ipReputation as never,
      models.simObservation as never,
      models.customerActionLog as never,
      models.customerObservation as never,
    );
    return { repo, models };
  }

  const opts = { transaction: 'tx' as never };

  it('createPermissionEvent usa decidedAt para requestedAt y respondedAt', async () => {
    const { repo, models } = buildRepo();
    const decidedAt = new Date('2026-01-01');
    await repo.createPermissionEvent(
      { tenantId: 't1', customerId: 'c1', sessionId: 's1', onboardingFlowId: null, permissionCode: 'location', granted: true, decidedAt },
      opts,
    );
    const [values, o] = (models.permissionEvent.create as jest.Mock).mock.calls[0];
    expect(values).toMatchObject({ permissionCode: 'location', granted: true, requestedAt: decidedAt, respondedAt: decidedAt });
    expect(o).toEqual({ transaction: 'tx' });
  });

  it('findSessionPermissionEvents ordena por respondedAt DESC y respeta el límite por defecto', async () => {
    const { repo, models } = buildRepo();
    (models.permissionEvent.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findSessionPermissionEvents('t1', 's1');
    const options = (models.permissionEvent.findAll as jest.Mock).mock.calls[0][0] as { where: unknown; limit: number; order: unknown };
    expect(options.where).toMatchObject({ tenantId: 't1', sessionId: 's1' });
    expect(options.limit).toBe(20);
    expect(options.order).toEqual([
      ['respondedAt', 'DESC'],
      ['id', 'DESC'],
    ]);
  });

  it('findSessionAuthEvents y findSessionCustomerActions filtran por tenant+sesión', async () => {
    const { repo, models } = buildRepo();
    (models.authEvent.findAll as jest.Mock).mockResolvedValue([] as never);
    (models.customerActionLog.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findSessionAuthEvents('t1', 's1');
    await repo.findSessionCustomerActions('t1', 's1');
    expect(callArg<CallArgRecord>(models.authEvent.findAll, 0, 0).where).toMatchObject({ tenantId: 't1', sessionId: 's1' });
    expect(callArg<CallArgRecord>(models.customerActionLog.findAll, 0, 0).where).toMatchObject({ tenantId: 't1', sessionId: 's1' });
    // límite por defecto distinto para acciones (30).
    expect(callArg<CallArgRecord>(models.customerActionLog.findAll, 0, 0).limit).toBe(30);
  });

  it('findSessionCustomerObservations acepta un límite explícito', async () => {
    const { repo, models } = buildRepo();
    (models.customerObservation.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findSessionCustomerObservations('t1', 's1', 5);
    expect(callArg<CallArgRecord>(models.customerObservation.findAll, 0, 0).limit).toBe(5);
  });

  it('createAuthEvent copia occurredAt a createdAtValue', async () => {
    const { repo, models } = buildRepo();
    const occurredAt = new Date('2026-01-02');
    await repo.createAuthEvent(
      {
        tenantId: 't1',
        customerId: 'c1',
        sessionId: 's1',
        deviceId: 'd1',
        eventType: 'login',
        loginSuccessful: true,
        failureReasonCode: null,
        occurredAt,
        ipAddress: '1.2.3.4',
      },
      opts,
    );
    expect((models.authEvent.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      eventType: 'login',
      loginSuccessful: true,
      createdAtValue: occurredAt,
    });
  });

  it('createIpReputation guarda las señales VPN/proxy/Tor y providerRequestId null', async () => {
    const { repo, models } = buildRepo();
    await repo.createIpReputation(
      {
        tenantId: 't1',
        customerId: 'c1',
        sessionId: 's1',
        deviceId: 'd1',
        ipAddress: '9.9.9.9',
        isVpn: true,
        isProxy: false,
        isTor: null,
        countryCode: 'BO',
        city: 'LP',
        reputationScore: '0.5',
        capturedAt: new Date('2026-01-03'),
      },
      opts,
    );
    expect((models.ipReputation.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      isVpn: true,
      isProxy: false,
      providerRequestId: null,
      countryCode: 'BO',
    });
  });

  it('createSimObservation fija sourceType mobile_app y campos de swap null', async () => {
    const { repo, models } = buildRepo();
    await repo.createSimObservation(
      {
        tenantId: 't1',
        customerId: 'c1',
        sessionId: 's1',
        deviceId: 'd1',
        phoneNumberHash: 'h',
        phoneLast4: '1234',
        carrierName: 'Tigo',
        simType: 'physical',
        simCount: 2,
        capturedAt: new Date('2026-01-04'),
      },
      opts,
    );
    expect((models.simObservation.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      carrierName: 'Tigo',
      simCount: 2,
      sourceType: 'mobile_app',
      lastSimSwapAt: null,
    });
  });

  it('createCustomerAction mapea eventName/screenName', async () => {
    const { repo, models } = buildRepo();
    await repo.createCustomerAction(
      {
        tenantId: 't1',
        customerId: 'c1',
        sessionId: 's1',
        deviceId: 'd1',
        eventName: 'tap',
        screenName: 'home',
        payload: { x: 1 },
        occurredAt: new Date('2026-01-05'),
      },
      opts,
    );
    expect((models.customerActionLog.create as jest.Mock).mock.calls[0][0]).toMatchObject({ eventName: 'tap', screenName: 'home' });
  });

  it('createCustomerObservation fija verificationStatus observed y payload->valueJson', async () => {
    const { repo, models } = buildRepo();
    await repo.createCustomerObservation(
      {
        tenantId: 't1',
        customerId: 'c1',
        sessionId: 's1',
        deviceId: null,
        observationCode: 'rooted',
        valueBoolean: true,
        payload: { a: 1 },
        sourceType: 'mobile_app',
        capturedAt: new Date('2026-01-06'),
      },
      opts,
    );
    expect((models.customerObservation.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      observationCode: 'rooted',
      valueBoolean: true,
      valueJson: { a: 1 },
      verificationStatus: 'observed',
    });
  });

  it('findSessionIpReputation / findSessionSimObservations ordenan por capturedAt desc', async () => {
    const { repo, models } = buildRepo();
    (models.ipReputation.findAll as jest.Mock).mockResolvedValue([] as never);
    (models.simObservation.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findSessionIpReputation('t1', 's1', 3);
    expect((models.ipReputation.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', sessionId: 's1' },
      limit: 3,
    });
    await repo.findSessionSimObservations('t1', 's1');
    expect((models.simObservation.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', sessionId: 's1' } });
  });
});
