import { describe, expect, it, jest } from '@jest/globals';
import { SessionsActivityAuditRepository } from '../../../src/modules/sessions/repositories/sessions-activity-audit.repository.js';

/**
 * Cobertura directa de `SessionsActivityAuditRepository` (Fase 1.2 del plan 10/10): upsert del
 * resumen de actividad del cliente (con sus dos ramas alta/actualización) y auditoría operativa de
 * sesiones. Modelos Sequelize mockeados.
 */
describe('SessionsActivityAuditRepository', () => {
  function buildRepo() {
    const customerActivitySummaryModel = { findOne: jest.fn(), create: jest.fn() };
    const operationalAuditLogModel = { create: jest.fn(), findAll: jest.fn() };
    const repo = new SessionsActivityAuditRepository(customerActivitySummaryModel as never, operationalAuditLogModel as never);
    return { repo, customerActivitySummaryModel, operationalAuditLogModel };
  }

  const opts = { transaction: 'tx' as never };
  const now = new Date('2026-01-13');

  it('upsertActivitySummary crea el resumen cuando no existe (totalSessions=1 al incrementar)', async () => {
    const { repo, customerActivitySummaryModel } = buildRepo();
    (customerActivitySummaryModel.findOne as jest.Mock).mockResolvedValue(null as never);
    (customerActivitySummaryModel.create as jest.Mock).mockResolvedValue({} as never);
    await repo.upsertActivitySummary({ tenantId: 't1', customerId: 'c1', deviceId: 'd1', now, incrementSessionCount: true }, opts);
    expect((customerActivitySummaryModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      firstSessionAt: now,
      totalSessions: 1,
      totalDevicesSeen: 1,
      computationVersion: 'sessions-v1',
    });
  });

  it('upsertActivitySummary crea con totalSessions=0 cuando no se incrementa', async () => {
    const { repo, customerActivitySummaryModel } = buildRepo();
    (customerActivitySummaryModel.findOne as jest.Mock).mockResolvedValue(null as never);
    (customerActivitySummaryModel.create as jest.Mock).mockResolvedValue({} as never);
    await repo.upsertActivitySummary({ tenantId: 't1', customerId: 'c1', deviceId: 'd1', now, incrementSessionCount: false }, opts);
    expect((customerActivitySummaryModel.create as jest.Mock).mock.calls[0][0].totalSessions).toBe(0);
  });

  it('upsertActivitySummary actualiza el existente e incrementa totalSessions', async () => {
    const { repo, customerActivitySummaryModel } = buildRepo();
    const save = jest.fn(async () => ({}));
    const existing = { totalSessions: 4, save } as never;
    (customerActivitySummaryModel.findOne as jest.Mock).mockResolvedValue(existing as never);
    await repo.upsertActivitySummary({ tenantId: 't1', customerId: 'c1', deviceId: 'd2', now, incrementSessionCount: true }, opts);
    expect((existing as { totalSessions: number; usualDeviceId: string }).totalSessions).toBe(5);
    expect((existing as { usualDeviceId: string }).usualDeviceId).toBe('d2');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
    expect(customerActivitySummaryModel.create).not.toHaveBeenCalled();
  });

  it('upsertActivitySummary trata totalSessions null del existente como 0 antes de incrementar', async () => {
    const { repo, customerActivitySummaryModel } = buildRepo();
    const save = jest.fn(async () => ({}));
    const existing = { totalSessions: null, save } as never;
    (customerActivitySummaryModel.findOne as jest.Mock).mockResolvedValue(existing as never);
    await repo.upsertActivitySummary({ tenantId: 't1', customerId: 'c1', deviceId: 'd2', now, incrementSessionCount: true }, opts);
    expect((existing as { totalSessions: number }).totalSessions).toBe(1);
  });

  it('createAudit fija actorPlatformUserId null y createdAtValue=occurredAt', async () => {
    const { repo, operationalAuditLogModel } = buildRepo();
    (operationalAuditLogModel.create as jest.Mock).mockResolvedValue({ id: 'a1' } as never);
    await repo.createAudit(
      {
        tenantId: 't1',
        actorType: 'internal',
        actorInternalUserId: 'u1',
        actionCode: 'session.end',
        targetType: 'session',
        targetId: 's1',
        ipAddress: null,
        userAgent: null,
        payload: null,
        occurredAt: now,
      },
      opts,
    );
    expect((operationalAuditLogModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      actorPlatformUserId: null,
      createdAtValue: now,
    });
  });

  it('findSessionAudits filtra por targetType=session y aplica límite por defecto 30', async () => {
    const { repo, operationalAuditLogModel } = buildRepo();
    (operationalAuditLogModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.findSessionAudits('t1', 's1');
    const arg = (operationalAuditLogModel.findAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; limit: number };
    expect(arg.where).toMatchObject({ targetType: 'session', targetId: 's1' });
    expect(arg.limit).toBe(30);
  });
});
