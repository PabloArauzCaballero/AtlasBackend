import { describe, expect, it, jest } from '@jest/globals';
import { SessionsLifecycleRepository } from '../../../src/modules/sessions/repositories/sessions-lifecycle.repository.js';

/**
 * Cobertura directa de `SessionsLifecycleRepository` (Fase 1.2 del plan 10/10): alta, cierre y
 * búsqueda de la sesión del cliente. Sub-repo con lógica real (defaults de alta, mutación en cierre,
 * paginación). Modelo Sequelize mockeado.
 */
describe('SessionsLifecycleRepository', () => {
  function buildRepo() {
    const customerSessionModel = { create: jest.fn(), findOne: jest.fn(), findAndCountAll: jest.fn() };
    const repo = new SessionsLifecycleRepository(customerSessionModel as never);
    return { repo, customerSessionModel };
  }

  const opts = { transaction: 'tx' as never };

  it('createSession nace activa, sin endedAt y con createdAtValue=now', async () => {
    const { repo, customerSessionModel } = buildRepo();
    (customerSessionModel.create as jest.Mock).mockResolvedValue({ id: 's1' } as never);
    const now = new Date('2026-01-01T00:00:00Z');
    await repo.createSession(
      {
        tenantId: 't1',
        customerId: 'c1',
        deviceId: 'd1',
        sessionTokenHash: 'h',
        channel: 'app',
        authMethod: 'pin',
        ipAddress: '1.2.3.4',
        userAgent: 'ua',
        gpsLat: '1',
        gpsLng: '2',
        gpsAccuracyMeters: '5',
        now,
      },
      opts,
    );
    const [values, callOpts] = (customerSessionModel.create as jest.Mock).mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(values).toMatchObject({ sessionStatus: 'active', endedAt: null, startedAt: now, createdAtValue: now });
    expect(callOpts).toEqual({ transaction: 'tx' });
  });

  it('findSessionById filtra por tenant+cliente+id', async () => {
    const { repo, customerSessionModel } = buildRepo();
    (customerSessionModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findSessionById('t1', 'c1', 's1', opts);
    expect((customerSessionModel.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', customerId: 'c1', id: 's1' },
      transaction: 'tx',
    });
  });

  it('findSessionForOperations busca por tenant+id sin cliente', async () => {
    const { repo, customerSessionModel } = buildRepo();
    (customerSessionModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findSessionForOperations('t1', 's1');
    expect((customerSessionModel.findOne as jest.Mock).mock.calls[0][0].where).toEqual({ tenantId: 't1', id: 's1' });
  });

  it('findLatestActiveSession filtra por estado activo y ordena desc', async () => {
    const { repo, customerSessionModel } = buildRepo();
    (customerSessionModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findLatestActiveSession('t1', 'c1');
    const arg = (customerSessionModel.findOne as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; order: unknown };
    expect(arg.where).toMatchObject({ sessionStatus: 'active' });
    expect(arg.order).toEqual([
      ['startedAt', 'DESC'],
      ['id', 'DESC'],
    ]);
  });

  it('endSession marca ended, fija endedAt y guarda dentro de la transacción', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async () => ({ id: 's1' }));
    const session = { save } as never;
    const endedAt = new Date('2026-02-02');
    await repo.endSession(session, endedAt, opts);
    expect((session as { endedAt: Date; sessionStatus: string }).endedAt).toBe(endedAt);
    expect((session as { sessionStatus: string }).sessionStatus).toBe('ended');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('findCustomerSessions pagina con offset derivado de page/limit', async () => {
    const { repo, customerSessionModel } = buildRepo();
    (customerSessionModel.findAndCountAll as jest.Mock).mockResolvedValue({ rows: [], count: 0 } as never);
    await repo.findCustomerSessions({ tenantId: 't1', customerId: 'c1', page: 3, limit: 10 });
    const arg = (customerSessionModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { limit: number; offset: number };
    expect(arg.limit).toBe(10);
    expect(arg.offset).toBe(20);
  });
});
