import { describe, expect, it, jest } from '@jest/globals';
import { NotificationOrchestratorService } from '../../../src/modules/notifications/notification-orchestrator.service.js';

/**
 * ATLAS-P12 (continuación, prioridad #1 de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9):
 * `NotificationOrchestratorService.handleEvent` es el servicio con el hallazgo de mayor riesgo ya
 * documentado por auditorías previas (duplicados de notificación) y, hasta este archivo, sin
 * ningún test. El caso más importante de todo este archivo es el codec de `idempotencyKey`
 * (`${idempotencyKey ?? eventCode}-${event.id}-${recipientId}-${channel}`): es la única barrera
 * real contra notificaciones duplicadas, y hasta ahora vivía sin verificación escrita.
 */
describe('NotificationOrchestratorService', () => {
  function buildAdapter(channel: string, overrides: Record<string, unknown> = {}) {
    return {
      supports: jest.fn((c: string) => c === channel),
      validatePayload: jest.fn(() => true),
      send: jest.fn(async () => ({ status: 'sent', provider: `${channel}-provider`, providerMessageId: 'ext-1', response: null })),
      getProviderName: jest.fn(() => `${channel}-provider`),
      ...overrides,
    };
  }

  function buildService() {
    const rulesService = { getRulesForEvent: jest.fn() };
    const repository = {
      isChannelEnabled: jest.fn(async () => true),
      findTemplate: jest.fn(async () => null),
      createMessage: jest.fn(async () => ({ id: 'msg-1' })),
      getMessageForDelivery: jest.fn(async () => ({
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
      })),
      getActiveDeviceTokenSecrets: jest.fn(async () => []),
      getCustomerContactTargets: jest.fn(async () => []),
      getMessageDeliveryTargets: jest.fn(async () => []),
      markMessageSending: jest.fn(async () => undefined),
      recordDelivery: jest.fn(async () => undefined),
    };
    const renderer = { render: jest.fn((_template: unknown, _payload: unknown, fallback: string) => fallback) };
    const inAppAdapter = buildAdapter('in_app');
    const emailAdapter = buildAdapter('email');
    const pushAdapter = buildAdapter('push');
    const smsAdapter = buildAdapter('sms');
    const whatsappAdapter = buildAdapter('whatsapp');

    const service = new NotificationOrchestratorService(
      rulesService as never,
      repository as never,
      renderer as never,
      inAppAdapter as never,
      emailAdapter as never,
      pushAdapter as never,
      smsAdapter as never,
      whatsappAdapter as never,
    );

    return {
      service,
      rulesService,
      repository,
      renderer,
      adapters: { inAppAdapter, emailAdapter, pushAdapter, smsAdapter, whatsappAdapter },
    };
  }

  function fakeEvent(overrides: Record<string, unknown> = {}) {
    return {
      id: 'event-1',
      tenantId: 't1',
      eventCode: 'user.registered',
      aggregateType: 'customer',
      aggregateId: 'c1',
      eventPayloadJson: {},
      idempotencyKey: null,
      correlationId: 'corr-1',
      priority: 0,
      ...overrides,
    };
  }

  describe('handleEvent — resolución de destinatario', () => {
    it('skips a rule entirely (no message created) when no recipientId can be resolved at all', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([
        {
          eventCode: 'x',
          channels: ['in_app'],
          recipientType: 'merchant',
          recipientIdPath: ['merchantId'],
          required: false,
          templatePrefix: 'x',
        },
      ] as never);

      // aggregateType is 'customer', not 'merchant', so defaultRecipientId returns null too.
      await service.handleEvent(fakeEvent({ aggregateType: 'customer', aggregateId: 'c1', eventPayloadJson: {} }) as never);

      expect(repository.createMessage).not.toHaveBeenCalled();
    });

    it('resolves recipientId from the payload path when present, before falling back to defaultRecipientId', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([
        {
          eventCode: 'x',
          channels: ['in_app'],
          recipientType: 'customer',
          recipientIdPath: ['customerId'],
          required: false,
          templatePrefix: 'x',
        },
      ] as never);

      await service.handleEvent(
        fakeEvent({
          aggregateType: 'customer',
          aggregateId: 'c-from-aggregate',
          eventPayloadJson: { customerId: 'c-from-payload' },
        }) as never,
      );

      const createArgs = (repository.createMessage as jest.Mock).mock.calls[0][0] as { recipientId: string };
      expect(createArgs.recipientId).toBe('c-from-payload');
    });

    it('falls back to event.aggregateId for a customer rule when the payload path resolves to nothing', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([
        {
          eventCode: 'x',
          channels: ['in_app'],
          recipientType: 'customer',
          recipientIdPath: ['customerId'],
          required: false,
          templatePrefix: 'x',
        },
      ] as never);

      await service.handleEvent(fakeEvent({ aggregateType: 'customer', aggregateId: 'c-from-aggregate', eventPayloadJson: {} }) as never);

      const createArgs = (repository.createMessage as jest.Mock).mock.calls[0][0] as { recipientId: string };
      expect(createArgs.recipientId).toBe('c-from-aggregate');
    });

    it('an "operations" rule falls back to the literal string "operations" when assignedTeamId is absent', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([
        {
          eventCode: 'risk.alert.created',
          channels: ['in_app'],
          recipientType: 'operations',
          recipientIdPath: ['assignedTeamId'],
          required: true,
          templatePrefix: 'x',
        },
      ] as never);

      await service.handleEvent(fakeEvent({ aggregateType: 'risk_alert', aggregateId: 'ra-1', eventPayloadJson: {} }) as never);

      const createArgs = (repository.createMessage as jest.Mock).mock.calls[0][0] as { recipientId: string };
      expect(createArgs.recipientId).toBe('operations');
    });
  });

  describe('handleEvent — canal habilitado (solo aplica a recipientType "customer")', () => {
    it('skips ONLY the disabled channel for a customer rule with multiple channels, not the whole rule', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([
        {
          eventCode: 'x',
          channels: ['in_app', 'email'],
          recipientType: 'customer',
          recipientIdPath: ['customerId'],
          required: false,
          templatePrefix: 'x',
        },
      ] as never);
      (repository.isChannelEnabled as jest.Mock).mockImplementation(async (args: { channel: string }) => args.channel !== 'email');

      await service.handleEvent(fakeEvent({ eventPayloadJson: { customerId: 'c1' } }) as never);

      const calledChannels = (repository.createMessage as jest.Mock).mock.calls.map((c) => (c[0] as { channel: string }).channel);
      expect(calledChannels).toEqual(['in_app']);
    });

    it('does NOT check isChannelEnabled for merchant or operations rules — only customer rules are opt-in/opt-out', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([
        {
          eventCode: 'merchant.settlement.ready',
          channels: ['in_app'],
          recipientType: 'merchant',
          recipientIdPath: ['merchantId'],
          required: true,
          templatePrefix: 'x',
        },
      ] as never);

      await service.handleEvent(fakeEvent({ aggregateType: 'merchant', aggregateId: 'm1', eventPayloadJson: {} }) as never);

      expect(repository.isChannelEnabled).not.toHaveBeenCalled();
      expect(repository.createMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleEvent — idempotencyKey: la barrera real contra duplicados', () => {
    it('the same event handled twice produces the exact same idempotencyKey for the same recipient+channel', async () => {
      const { service, rulesService, repository } = buildService();
      const rule = {
        eventCode: 'x',
        channels: ['in_app'],
        recipientType: 'customer' as const,
        recipientIdPath: ['customerId'],
        required: false,
        templatePrefix: 'x',
      };
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValue([rule] as never);

      const event = fakeEvent({ eventPayloadJson: { customerId: 'c1' } });
      await service.handleEvent(event as never);
      await service.handleEvent(event as never);

      const keys = (repository.createMessage as jest.Mock).mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
      expect(keys[0]).toBe(keys[1]);
    });

    it('the same event to two different channels produces two DIFFERENT idempotencyKeys — must not be conflated as duplicates', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([
        {
          eventCode: 'x',
          channels: ['in_app', 'sms'],
          recipientType: 'customer',
          recipientIdPath: ['customerId'],
          required: false,
          templatePrefix: 'x',
        },
      ] as never);

      await service.handleEvent(fakeEvent({ eventPayloadJson: { customerId: 'c1' } }) as never);

      const keys = (repository.createMessage as jest.Mock).mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
      expect(new Set(keys).size).toBe(2);
    });

    it('two different recipients for the same event+channel produce two different idempotencyKeys', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValue([
        {
          eventCode: 'x',
          channels: ['in_app'],
          recipientType: 'operations',
          recipientIdPath: ['assignedTeamId'],
          required: true,
          templatePrefix: 'x',
        },
      ] as never);

      await service.handleEvent(fakeEvent({ id: 'event-1', eventPayloadJson: { assignedTeamId: 'team-a' } }) as never);
      await service.handleEvent(fakeEvent({ id: 'event-1', eventPayloadJson: { assignedTeamId: 'team-b' } }) as never);

      const keys = (repository.createMessage as jest.Mock).mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
      expect(keys[0]).not.toBe(keys[1]);
    });

    it('uses event.idempotencyKey as the seed when present, falling back to eventCode only when it is null', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([
        {
          eventCode: 'x',
          channels: ['in_app'],
          recipientType: 'customer',
          recipientIdPath: ['customerId'],
          required: false,
          templatePrefix: 'x',
        },
      ] as never);

      await service.handleEvent(fakeEvent({ idempotencyKey: 'client-supplied-key', eventPayloadJson: { customerId: 'c1' } }) as never);

      const key = (repository.createMessage as jest.Mock).mock.calls[0][0] as { idempotencyKey: string };
      expect(key.idempotencyKey.startsWith('client-supplied-key-')).toBe(true);
    });
  });

  describe('handleEvent — plantillas y fallback', () => {
    it('only renders "subject" for the email channel, leaving it null for every other channel', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([
        {
          eventCode: 'x',
          channels: ['in_app', 'email'],
          recipientType: 'customer',
          recipientIdPath: ['customerId'],
          required: false,
          templatePrefix: 'x',
        },
      ] as never);

      await service.handleEvent(fakeEvent({ eventPayloadJson: { customerId: 'c1' } }) as never);

      const [inAppCall, emailCall] = (repository.createMessage as jest.Mock).mock.calls as Array<
        [{ channel: string; subject: string | null }]
      >;
      expect(inAppCall[0].subject).toBeNull();
      expect(emailCall[0].subject).not.toBeNull();
    });

    it('calls handleEvent -> deliverMessage automatically for every message created', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([
        {
          eventCode: 'x',
          channels: ['in_app'],
          recipientType: 'customer',
          recipientIdPath: ['customerId'],
          required: false,
          templatePrefix: 'x',
        },
      ] as never);
      (repository.getMessageForDelivery as jest.Mock).mockResolvedValueOnce({
        id: 'msg-1',
        status: 'queued',
        channel: 'in_app',
        tenantId: 't1',
        recipientType: 'customer',
        recipientId: 'c1',
        payloadJson: {},
      } as never);

      await service.handleEvent(fakeEvent({ eventPayloadJson: { customerId: 'c1' } }) as never);

      expect(repository.getMessageForDelivery).toHaveBeenCalledWith('msg-1');
    });
  });

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

      expect(repository.getActiveDeviceTokenSecrets).not.toHaveBeenCalled();
    });

    it('fetches FCM device tokens when channel is push and recipientType is customer', async () => {
      const { service, repository, adapters } = buildService();
      (repository.getMessageForDelivery as jest.Mock).mockResolvedValueOnce(
        fakeMessage({ channel: 'push', recipientType: 'customer' }) as never,
      );
      (repository.getActiveDeviceTokenSecrets as jest.Mock).mockResolvedValueOnce(['token-a', 'token-b'] as never);

      await service.deliverMessage('msg-1');

      expect(repository.getActiveDeviceTokenSecrets).toHaveBeenCalledWith('t1', 'c1');
      const sentPayload = (adapters.pushAdapter.send as jest.Mock).mock.calls[0][0] as { deliveryTargets: Array<{ kind: string }> };
      expect(sentPayload.deliveryTargets.filter((t) => t.kind === 'fcm_token')).toHaveLength(2);
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
});
