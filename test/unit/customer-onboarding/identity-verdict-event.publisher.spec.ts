import { describe, expect, it, jest } from '@jest/globals';
import { IdentityVerdictEventPublisher } from '../../../src/modules/customer-onboarding/application/identity-verdict-event.publisher.js';

/**
 * A8: el veredicto de identidad sale por el outbox como `kyc.approved`/`kyc.rejected`, con lo que el
 * orquestador de notificaciones necesita para encontrar al cliente, y sin avisar dos veces.
 */
describe('IdentityVerdictEventPublisher', () => {
  function build(existing: unknown = null) {
    const outboxModel = {
      findOne: jest.fn(async (..._args: unknown[]) => existing),
      create: jest.fn(async (..._args: unknown[]) => ({ id: '77', eventId: 'ev-77' })),
    };
    return { publisher: new IdentityVerdictEventPublisher(outboxModel as never), outboxModel };
  }
  const tx = { id: 'tx' } as never;
  const base = {
    tenantId: '1',
    customerId: '10',
    attemptId: '35',
    source: 'manual_review' as const,
    reasonCode: null,
    decidedAt: new Date('2026-09-27T10:00:00Z'),
  };

  it('verified → kyc.approved sobre el agregado customer, con customerId en el payload y en la transacción', async () => {
    const { publisher, outboxModel } = build();
    await publisher.publish({ ...base, verdict: 'verified' }, tx);

    const [fila, opciones] = outboxModel.create.mock.calls[0] as [Record<string, unknown>, { transaction: unknown }];
    expect(fila).toMatchObject({
      tenantId: '1',
      eventCode: 'kyc.approved',
      aggregateType: 'customer',
      aggregateId: '10',
      eventFamily: 'domain',
      status: 'pending',
      idempotencyKey: 'identity-verdict:35',
      eventPayloadJson: {
        customerId: '10',
        identityVerificationAttemptId: '35',
        verdict: 'verified',
        source: 'manual_review',
        reasonCode: null,
        decidedAt: '2026-09-27T10:00:00.000Z',
      },
    });
    expect(opciones.transaction).toBe(tx);
  });

  it('rejected → kyc.rejected', async () => {
    const { publisher, outboxModel } = build();
    await publisher.publish({ ...base, verdict: 'rejected', reasonCode: 'MANUAL_REVIEW_REJECTED' }, tx);
    expect(outboxModel.create.mock.calls[0]![0]).toMatchObject({ eventCode: 'kyc.rejected' });
  });

  it('un callback reenviado del mismo intento no escribe otra fila (el índice único revertiría el veredicto)', async () => {
    const { publisher, outboxModel } = build({ id: '76' });
    await publisher.publish({ ...base, verdict: 'verified' }, tx);
    expect(outboxModel.findOne).toHaveBeenCalledWith({
      where: { tenantId: '1', eventCode: 'kyc.approved', idempotencyKey: 'identity-verdict:35' },
      transaction: tx,
    });
    expect(outboxModel.create).not.toHaveBeenCalled();
  });
});
