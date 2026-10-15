import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { NotificationMessagesService } from '../../../src/modules/notifications/notification-messages.service.js';

/** Consulta, reintento y cancelación de mensajes; los mappers corren de verdad. */
describe('NotificationMessagesService', () => {
  function build() {
    const messages = {
      listMessages: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })),
      getMessage: jest.fn(async (..._args: unknown[]) => ({ id: 1, channel: 'in_app', status: 'sent' })),
      markMessageRetrying: jest.fn(async (..._args: unknown[]) => true),
      cancelMessage: jest.fn(async (..._args: unknown[]) => ({ id: 1, status: 'cancelled' })),
    };
    const deliveries = { listDeliveries: jest.fn(async (..._args: unknown[]) => []) };
    const orchestrator = { deliverMessage: jest.fn(async (..._args: unknown[]) => undefined) };
    const service = new NotificationMessagesService(messages as never, deliveries as never, orchestrator as never);
    return { service, messages, deliveries, orchestrator };
  }

  it('listMessages pagina con totalPages = ceil(total/limit)', async () => {
    const { service, messages } = build();
    (messages.listMessages as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 1, channel: 'in_app', status: 'sent' }],
      count: 25,
    } as never);
    const res = await service.listMessages('1', { page: 1, limit: 10 } as never);
    expect(res.data).toHaveLength(1);
    expect(res.pagination).toMatchObject({ total: 25, totalPages: 3 });
  });

  it('getMessage combina el mensaje con sus deliveries', async () => {
    const { service, messages, deliveries } = build();
    (messages.getMessage as jest.Mock).mockResolvedValueOnce({ id: 7, channel: 'email', status: 'sent' } as never);
    (deliveries.listDeliveries as jest.Mock).mockResolvedValueOnce([
      { id: 1, notificationMessageId: 7, channel: 'email', status: 'sent', attemptNumber: 1 },
    ] as never);
    const res = await service.getMessage('1', '7');
    expect(res).toMatchObject({ id: '7' });
    expect(res.deliveries).toHaveLength(1);
  });

  it('retryMessage reabre el mensaje fallido, dispara el orchestrator y relee', async () => {
    const { service, messages, orchestrator } = build();
    const failed = { id: 1, channel: 'in_app', status: 'failed' };
    (messages.getMessage as jest.Mock).mockResolvedValue(failed as never);
    await service.retryMessage('1', '1');
    expect(messages.markMessageRetrying).toHaveBeenCalledWith(failed);
    expect(orchestrator.deliverMessage).toHaveBeenCalledWith('1');
  });

  it('retryMessage no reenvía un mensaje entregado, leído o cancelado: 409 MESSAGE_NOT_RETRYABLE', async () => {
    const { service, messages, orchestrator } = build();
    (messages.markMessageRetrying as jest.Mock).mockResolvedValueOnce(false as never);
    await expect(service.retryMessage('1', '1')).rejects.toBeInstanceOf(ConflictException);
    expect(orchestrator.deliverMessage).not.toHaveBeenCalled();
  });

  it('cancelMessage delega y mapea', async () => {
    const { service, messages } = build();
    await service.cancelMessage('1', 'm1');
    expect(messages.cancelMessage).toHaveBeenCalledWith('1', 'm1');
  });
});
