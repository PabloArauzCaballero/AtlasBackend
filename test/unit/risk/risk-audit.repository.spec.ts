import { describe, expect, it, jest } from '@jest/globals';
import { RiskAuditRepository } from '../../../src/modules/risk/repositories/risk-audit.repository.js';

/** Cobertura directa de la auditoría de la evaluación. */
const now = new Date('2026-01-01T00:00:00.000Z');

describe('RiskAuditRepository', () => {
  it('createAudit mapea sus constantes y escribe dentro de la transacción', async () => {
    const create = jest.fn();
    const repo = new RiskAuditRepository({ create } as never);
    await repo.createAudit(
      {
        tenantId: 't1',
        actorType: 'system',
        actorInternalUserId: null,
        actionCode: 'risk.assessed',
        targetId: 'c1',
        payload: { p: 1 },
        now,
      } as never,
      { transaction: 'tx' as never },
    );
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({
      targetType: 'customer',
      actionCode: 'risk.assessed',
      payloadJson: { p: 1 },
      actorPlatformUserId: null,
    });
    expect((create.mock.calls[0] as unknown[])[1]).toEqual({ transaction: 'tx' });
  });
});
