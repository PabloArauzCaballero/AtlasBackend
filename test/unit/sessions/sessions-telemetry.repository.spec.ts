import { describe, expect, it, jest } from '@jest/globals';
import { SessionsTelemetryRepository } from '../../../src/modules/sessions/repositories/sessions-telemetry.repository.js';

/**
 * Cobertura directa de `SessionsTelemetryRepository` (Fase 1.2 del plan 10/10): las escrituras y
 * lecturas de la telemetría por sesión (permisos, auth, IP, SIM, acciones, observaciones). Sub-repo
 * con lógica real (mapeo de fechas de la decisión). Modelos Sequelize mockeados.
 */
describe('SessionsTelemetryRepository', () => {
  function buildRepo() {
    const make = () => ({ findAll: jest.fn(), create: jest.fn() });
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
    expect((models.authEvent.findAll as jest.Mock).mock.calls[0][0].where).toMatchObject({ tenantId: 't1', sessionId: 's1' });
    expect((models.customerActionLog.findAll as jest.Mock).mock.calls[0][0].where).toMatchObject({ tenantId: 't1', sessionId: 's1' });
    // límite por defecto distinto para acciones (30).
    expect((models.customerActionLog.findAll as jest.Mock).mock.calls[0][0].limit).toBe(30);
  });

  it('findSessionCustomerObservations acepta un límite explícito', async () => {
    const { repo, models } = buildRepo();
    (models.customerObservation.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findSessionCustomerObservations('t1', 's1', 5);
    expect((models.customerObservation.findAll as jest.Mock).mock.calls[0][0].limit).toBe(5);
  });
});
