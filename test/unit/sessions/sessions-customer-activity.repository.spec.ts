import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { SessionsCustomerActivityRepository } from '../../../src/modules/sessions/repositories/sessions-customer-activity.repository.js';

/** Acciones y observaciones del cliente por sesión (modelos Sequelize mockeados). */
describe('SessionsCustomerActivityRepository', () => {
  function buildRepo() {
    const make = () => ({ findAll: asyncMock(), create: asyncMock() });
    const models = { customerActionLog: make(), customerObservation: make() };
    const repo = new SessionsCustomerActivityRepository(models.customerActionLog as never, models.customerObservation as never);
    return { repo, models };
  }

  const opts = { transaction: 'tx' as never };

  it('findSessionCustomerActions filtra por tenant+sesión con límite por defecto de 30', async () => {
    const { repo, models } = buildRepo();
    (models.customerActionLog.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findSessionCustomerActions('t1', 's1');
    expect(callArg<CallArgRecord>(models.customerActionLog.findAll, 0, 0).where).toMatchObject({ tenantId: 't1', sessionId: 's1' });
    expect(callArg<CallArgRecord>(models.customerActionLog.findAll, 0, 0).limit).toBe(30);
  });

  it('findSessionCustomerObservations acepta un límite explícito', async () => {
    const { repo, models } = buildRepo();
    (models.customerObservation.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findSessionCustomerObservations('t1', 's1', 5);
    expect(callArg<CallArgRecord>(models.customerObservation.findAll, 0, 0).limit).toBe(5);
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
});
