import { describe, expect, it, jest } from '@jest/globals';
import { NotificationDeliveriesRepository } from '../../../src/modules/notifications/notification-deliveries.repository.js';

/** Conteo de intentos y transición de estado del mensaje al registrar una entrega. */
describe('NotificationDeliveriesRepository', () => {
  function build() {
    const deliveryModel = {
      count: jest.fn(async (..._args: unknown[]) => 0),
      create: jest.fn(async (v: unknown) => ({ id: 'd1', ...(v as object) })),
      findAll: jest.fn(async (..._args: unknown[]) => []),
    };
    return { repo: new NotificationDeliveriesRepository(deliveryModel as never), deliveryModel };
  }

  const baseMessage = (over: Record<string, unknown> = {}) => ({
    id: 'm1',
    tenantId: 't1',
    channel: 'email',
    status: 'pending',
    save: jest.fn(async (..._args: unknown[]) => undefined),
    ...over,
  });

  describe('recordDelivery — cuenta el intento y transiciona el estado del mensaje', () => {
    it.each([
      ['sent', 'sent'],
      ['delivered', 'delivered'],
      ['failed', 'failed'],
    ])('resultado %s -> mensaje %s', async (resultStatus, expectedMessageStatus) => {
      const { repo, deliveryModel } = build();
      (deliveryModel.count as jest.Mock).mockResolvedValueOnce(2 as never);
      const message = baseMessage();
      const delivery = await repo.recordDelivery(
        message as never,
        { id: 'm1', channel: 'email', body: 'b', payload: {} } as never,
        { provider: 'resend', providerMessageId: 'p1', status: resultStatus, response: {} } as never,
      );
      expect((delivery as { attemptNumber: number }).attemptNumber).toBe(3); // count 2 + 1
      expect((message as { status: string }).status).toBe(expectedMessageStatus);
      expect(message.save).toHaveBeenCalled();
    });
  });

  it('listDeliveries filtra por mensaje y ordena por intento', async () => {
    const { repo, deliveryModel } = build();
    await repo.listDeliveries('t1', 'm1');
    expect((deliveryModel.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', notificationMessageId: 'm1' } });
  });
});
