import { describe, expect, it, jest } from '@jest/globals';
import { buildService, fakeEvent } from './support/notification-fixtures.js';

describe('NotificationDispatchService', () => {
  describe('deliverMessage', () => {
    function fakeMessage(overrides: Record<string, unknown> = {}) {
      return {
        id: 'msg-1',
        status: 'queued',
        channel: 'in_app',
        tenantId: 't1',
        recipientType: 'customer',
        recipientId: 'c1',
        subject: null,
        title: 'title',
        body: 'body',
        payloadJson: {},
        correlationId: null,
        ...overrides,
      };
    }

    it.each(['sent', 'delivered', 'read', 'cancelled'])(
      'is a no-op (never calls send) when the message status is already "%s"',
      async (status) => {
        const { service, repository, adapters } = buildService();
        (repository.getMessageForDelivery as jest.Mock).mockResolvedValueOnce(fakeMessage({ status }) as never);

        await service.deliverMessage('msg-1');

        expect(adapters.inAppAdapter.send).not.toHaveBeenCalled();
        expect(repository.markMessageSending).not.toHaveBeenCalled();
      },
    );

    it('throws NO_ADAPTER_FOR_CHANNEL_<channel> when no adapter supports the message channel', async () => {
      const { service, repository, adapters } = buildService();
      (repository.getMessageForDelivery as jest.Mock).mockResolvedValueOnce(fakeMessage({ channel: 'whatsapp' }) as never);
      (adapters.whatsappAdapter.supports as jest.Mock).mockReturnValue(false as never);

      await expect(service.deliverMessage('msg-1')).rejects.toThrow(/NO_ADAPTER_FOR_CHANNEL_whatsapp/);
    });

    it('throws INVALID_PAYLOAD_FOR_CHANNEL_<channel> when the adapter rejects the payload, without marking the message as sending', async () => {
      const { service, repository, adapters } = buildService();
      (repository.getMessageForDelivery as jest.Mock).mockResolvedValueOnce(fakeMessage() as never);
      (adapters.inAppAdapter.validatePayload as jest.Mock).mockReturnValue(false as never);

      await expect(service.deliverMessage('msg-1')).rejects.toThrow(/INVALID_PAYLOAD_FOR_CHANNEL_in_app/);
      expect(repository.markMessageSending).not.toHaveBeenCalled();
    });

    it('only fetches FCM device tokens for push + customer, never for other channel/recipient combinations', async () => {
      const { service, repository } = buildService();
      (repository.getMessageForDelivery as jest.Mock).mockResolvedValueOnce(fakeMessage({ channel: 'in_app' }) as never);

      await service.deliverMessage('msg-1');

      expect(repository.getActivePushDevices).not.toHaveBeenCalled();
    });

    it('fetches FCM device tokens when channel is push and recipientType is customer', async () => {
      const { service, repository, adapters } = buildService();
      (repository.getMessageForDelivery as jest.Mock).mockResolvedValueOnce(
        fakeMessage({ channel: 'push', recipientType: 'customer' }) as never,
      );
      (repository.getActivePushDevices as jest.Mock).mockResolvedValueOnce([
        { token: 'token-a', platform: 'android' },
        { token: 'token-b', platform: 'ios' },
      ] as never);

      await service.deliverMessage('msg-1');

      expect(repository.getActivePushDevices).toHaveBeenCalledWith('t1', 'c1');
      const sentPayload = (adapters.pushAdapter.send as jest.Mock).mock.calls[0][0] as {
        deliveryTargets: Array<{ kind: string; metadata?: { platform?: string } }>;
      };
      const push = sentPayload.deliveryTargets.filter((t) => t.kind === 'fcm_token');
      expect(push).toHaveLength(2);
      // Sin la plataforma, el adaptador no puede separar iPhone de Android.
      expect(push.map((t) => t.metadata?.platform)).toEqual(['android', 'ios']);
    });

    it('does not send when another batch claimed the message first (markMessageSending → false)', async () => {
      const { service, repository, adapters } = buildService();
      (repository.getMessageForDelivery as jest.Mock).mockResolvedValueOnce(fakeMessage({ status: 'pending' }) as never);
      (repository.markMessageSending as jest.Mock).mockResolvedValueOnce(false as never);

      await service.deliverMessage('msg-1');

      expect(adapters.inAppAdapter.send).not.toHaveBeenCalled();
      expect(repository.recordDelivery).not.toHaveBeenCalled();
    });

    it('records a successful delivery result from the adapter', async () => {
      const { service, repository, adapters } = buildService();
      (repository.getMessageForDelivery as jest.Mock).mockResolvedValueOnce(fakeMessage() as never);
      (adapters.inAppAdapter.send as jest.Mock).mockResolvedValueOnce({
        status: 'sent',
        provider: 'in_app-provider',
        providerMessageId: 'x',
        response: null,
      } as never);

      await service.deliverMessage('msg-1');

      expect(repository.markMessageSending).toHaveBeenCalledTimes(1);
      const recordArgs = (repository.recordDelivery as jest.Mock).mock.calls[0][2] as { status: string };
      expect(recordArgs.status).toBe('sent');
    });

    it('when the adapter throws, deliverMessage does NOT re-throw — it records a failed delivery instead', async () => {
      const { service, repository, adapters } = buildService();
      (repository.getMessageForDelivery as jest.Mock).mockResolvedValueOnce(fakeMessage() as never);
      (adapters.inAppAdapter.send as jest.Mock).mockRejectedValueOnce(new Error('provider timeout') as never);

      await expect(service.deliverMessage('msg-1')).resolves.toBeUndefined();

      const recordArgs = (repository.recordDelivery as jest.Mock).mock.calls[0][2] as { status: string; errorMessage: string };
      expect(recordArgs.status).toBe('failed');
      expect(recordArgs.errorMessage).toBe('provider timeout');
    });
  });

  describe('entrega con adapter que lanza algo que no es Error', () => {
    it('si el adapter lanza algo que no es Error, registra el código genérico ADAPTER_SEND_FAILED', async () => {
      const { service, repository, adapters } = buildService();
      (adapters.inAppAdapter.send as jest.Mock).mockImplementationOnce(() => {
        throw 'string suelto';
      });

      await service.deliverMessage('msg-1');

      const recordArgs = (repository.recordDelivery as jest.Mock).mock.calls[0][2] as { errorCode: string; errorMessage: string };
      expect(recordArgs.errorCode).toBe('ADAPTER_SEND_FAILED');
      expect(recordArgs.errorMessage).toBe('Fallo no identificado en adapter de notificación.');
    });
  });
});
