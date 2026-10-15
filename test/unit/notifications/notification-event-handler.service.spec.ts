import { describe, expect, it, jest } from '@jest/globals';
import { buildService, fakeEvent } from './support/notification-fixtures.js';

/**
 * ATLAS-P12 (continuación, prioridad #1 de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9):
 * `NotificationEventHandlerService.handleEvent` es el servicio con el hallazgo de mayor riesgo ya
 * documentado por auditorías previas (duplicados de notificación). El caso más importante es el
 * codec de `idempotencyKey` (`${idempotencyKey ?? eventCode}-${event.id}-${recipientId}-${channel}`):
 * es la única barrera real contra notificaciones duplicadas.
 */
describe('NotificationEventHandlerService', () => {
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
      repository.isChannelEnabled.mockImplementation(async (...args: unknown[]) => (args[0] as { channel: string }).channel !== 'email');

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

    it('el mensaje NO hereda del payload del evento el HTML, las copias ni el destino: salen de la plantilla y de los contactos', async () => {
      const { service, rulesService, repository, renderer } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([
        {
          eventCode: 'x',
          channels: ['email'],
          recipientType: 'customer',
          recipientIdPath: ['customerId'],
          required: false,
          templatePrefix: 'x',
        },
      ] as never);
      const eventPayload = {
        customerId: 'c1',
        amount: 10,
        html: '<a href="https://phish">Verifica</a>',
        htmlBody: '<p>x</p>',
        bcc: ['victima@x.com'],
        CC: 'otro@x.com',
        replyTo: 'atacante@x.com',
        email: 'tercero@x.com',
        smsTo: '+59170000000',
        fcmToken: 'tok',
      };

      await service.handleEvent(fakeEvent({ eventPayloadJson: eventPayload }) as never);

      const [[created]] = (repository.createMessage as jest.Mock).mock.calls as Array<[{ payload: Record<string, unknown> }]>;
      expect(created.payload).toEqual({ customerId: 'c1', amount: 10 });
      // La plantilla sí se rinde con el payload entero: quitar claves de envío no quita datos al texto.
      expect((renderer.render as jest.Mock).mock.calls[0][1]).toBe(eventPayload);
    });

    it('handleEvent entrega cada mensaje creado SIN re-leerlo (optimización #1: pasa el modelo directo)', async () => {
      const { service, rulesService, repository, adapters } = buildService();
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

      await service.handleEvent(fakeEvent({ eventPayloadJson: { customerId: 'c1' } }) as never);

      // El mensaje recién creado se entrega (adapter.send) sin una segunda lectura de DB.
      expect(repository.createMessage).toHaveBeenCalledTimes(1);
      expect(adapters.inAppAdapter.send).toHaveBeenCalledTimes(1);
      expect(repository.getMessageForDelivery).not.toHaveBeenCalled();
    });
  });

  describe('ramas de derivación restantes', () => {
    const rule = (over: Record<string, unknown> = {}) => ({
      eventCode: 'x',
      channels: ['in_app'],
      recipientType: 'customer',
      recipientIdPath: ['customerId'],
      required: false,
      templatePrefix: 'x',
      ...over,
    });

    it('una regla merchant cae al aggregateId cuando el aggregateType es merchant', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([rule({ recipientType: 'merchant' })] as never);

      await service.handleEvent(fakeEvent({ aggregateType: 'merchant', aggregateId: 'm-1', eventPayloadJson: {} }) as never);

      expect((repository.createMessage as jest.Mock).mock.calls[0][0]).toMatchObject({ recipientType: 'merchant', recipientId: 'm-1' });
    });

    it('tolera eventPayloadJson null y un conjunto de reglas no-array (no crea nada, no revienta)', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce(undefined as never);
      await service.handleEvent(fakeEvent({ eventPayloadJson: null }) as never);
      expect(repository.createMessage).not.toHaveBeenCalled();
    });

    it('con plantilla registrada toma su category/icon y la prioridad del evento', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([rule()] as never);
      (repository.findTemplate as jest.Mock).mockResolvedValue({
        subjectTemplate: 'S',
        titleTemplate: 'T',
        bodyTemplate: 'B',
        category: 'system_alert',
        icon: 'bell',
      } as never);

      await service.handleEvent(fakeEvent({ aggregateType: 'customer', aggregateId: 'c1', eventPayloadJson: {}, priority: 77 }) as never);

      expect((repository.createMessage as jest.Mock).mock.calls[0][0]).toMatchObject({
        category: 'system_alert',
        icon: 'bell',
        priority: 77,
      });
    });

    it('sin plantilla ni prioridad, category/icon quedan en null y la prioridad en 0; el templateCode deriva del eventCode', async () => {
      const { service, rulesService, repository } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([rule({ templatePrefix: undefined })] as never);

      await service.handleEvent(
        fakeEvent({
          eventCode: 'user.registered',
          aggregateType: 'customer',
          aggregateId: 'c1',
          eventPayloadJson: {},
          priority: null,
        }) as never,
      );

      expect((repository.createMessage as jest.Mock).mock.calls[0][0]).toMatchObject({ category: null, icon: null, priority: 0 });
      // templatePrefix ausente -> se usa el eventCode con puntos reemplazados
      expect((repository.findTemplate as jest.Mock).mock.calls[0][0]).toMatchObject({ code: 'user_registered_in_app' });
    });

    it('cuando el mensaje creado no expone .id, resuelve el id vía getDataValue (sin re-leer de DB)', async () => {
      const { service, rulesService, repository, adapters } = buildService();
      (rulesService.getRulesForEvent as jest.Mock).mockReturnValueOnce([rule()] as never);
      (repository.createMessage as jest.Mock).mockResolvedValueOnce({
        id: undefined,
        getDataValue: jest.fn((..._args: unknown[]) => 'msg-from-datavalue'),
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
      } as never);

      await service.handleEvent(fakeEvent({ aggregateType: 'customer', aggregateId: 'c1', eventPayloadJson: {} }) as never);

      // Se entrega el modelo directo (no hay re-lectura); el id del payload se resuelve por getDataValue.
      expect(repository.getMessageForDelivery).not.toHaveBeenCalled();
      const payload = (adapters.inAppAdapter.send as jest.Mock).mock.calls[0][0] as { id: string };
      expect(payload.id).toBe('msg-from-datavalue');
    });
  });
});
