import { jest } from '@jest/globals';
import { asyncMock } from '../../../support/jest-mocks.js';
import { NotificationChannelRegistry } from '../../../../src/modules/notifications/notification-channel-registry.service.js';
import { NotificationDeliveryPayloadBuilder } from '../../../../src/modules/notifications/notification-delivery-payload.builder.js';
import { NotificationDispatchService } from '../../../../src/modules/notifications/notification-dispatch.service.js';
import { NotificationEventHandlerService } from '../../../../src/modules/notifications/notification-event-handler.service.js';

/** Fixtures compartidos por las pruebas del manejador de eventos y del despacho de notificaciones. */
export function buildAdapter(channel: string, overrides: Record<string, unknown> = {}) {
  return {
    supports: jest.fn((c: string) => c === channel),
    validatePayload: jest.fn((..._args: unknown[]) => true),
    send: jest.fn(async (..._args: unknown[]) => ({
      status: 'sent',
      provider: `${channel}-provider`,
      providerMessageId: 'ext-1',
      response: null,
    })),
    getProviderName: jest.fn((..._args: unknown[]) => `${channel}-provider`),
    ...overrides,
  };
}

export function buildService() {
  const rulesService = { getRulesForEvent: asyncMock() };
  const repository = {
    isChannelEnabled: jest.fn(async (..._args: unknown[]) => true),
    findTemplate: jest.fn(async (..._args: unknown[]) => null),
    // createMessage devuelve el modelo COMPLETO (como en producción): handleEvent ahora lo pasa
    // directo a deliverMessage sin re-leer (optimización #1), así que necesita channel/status/etc.
    createMessage: jest.fn(async (..._args: unknown[]) => ({
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
    getMessageForDelivery: jest.fn(async (..._args: unknown[]) => ({
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
    getActivePushDevices: jest.fn(async (..._args: unknown[]) => []),
    getCustomerContactTargets: jest.fn(async (..._args: unknown[]) => []),
    markMessageSending: jest.fn(async (..._args: unknown[]) => true),
    recordDelivery: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const renderer = { render: jest.fn((_template: unknown, _payload: unknown, fallback: string) => fallback) };
  const inAppAdapter = buildAdapter('in_app');
  const emailAdapter = buildAdapter('email');
  const pushAdapter = buildAdapter('push');
  const smsAdapter = buildAdapter('sms');
  const whatsappAdapter = buildAdapter('whatsapp');

  const dispatch = new NotificationDispatchService(
    repository as never, // messages
    repository as never, // deliveries
    new NotificationChannelRegistry(
      inAppAdapter as never,
      emailAdapter as never,
      pushAdapter as never,
      smsAdapter as never,
      whatsappAdapter as never,
    ),
    new NotificationDeliveryPayloadBuilder(repository as never),
  );
  const handler = new NotificationEventHandlerService(
    rulesService as never,
    repository as never, // preferences
    repository as never, // templates
    renderer as never,
    repository as never, // messages
    dispatch,
  );
  const service = {
    handleEvent: handler.handleEvent.bind(handler),
    deliverMessage: dispatch.deliverMessage.bind(dispatch),
  };

  return {
    service,
    rulesService,
    repository,
    renderer,
    adapters: { inAppAdapter, emailAdapter, pushAdapter, smsAdapter, whatsappAdapter },
  };
}

export function fakeEvent(overrides: Record<string, unknown> = {}) {
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
