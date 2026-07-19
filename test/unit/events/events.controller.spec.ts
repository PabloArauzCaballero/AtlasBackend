import { describe, expect, it, jest } from '@jest/globals';
import { EventsController } from '../../../src/modules/events/events.controller.js';
import { requireIdempotencyKey, tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';

/**
 * `EventsController` es la cara HTTP del outbox de eventos. Spec directo con el servicio mockeado:
 * verifica el wrapping en `{ data }`, el parseo de tenant y la exigencia de x-idempotency-key en las
 * mutaciones (publicar/retry/cancel).
 */
describe('EventsController', () => {
  function build() {
    const service = {
      listDefinitions: jest.fn(() => [{ code: 'X' }]),
      listEvents: jest.fn(async () => ({ items: [] })),
      getEvent: jest.fn(async () => ({ id: '7' })),
      publishFromDto: jest.fn(async () => ({ id: '8' })),
      retryEvent: jest.fn(async () => ({ retried: true })),
      cancelEvent: jest.fn(async () => ({ cancelled: true })),
    };
    return { controller: new EventsController(service as never), service };
  }
  const key = 'idem-key-123';

  it('listCatalog envuelve las definiciones en { data }', () => {
    const { controller } = build();
    expect(controller.listCatalog()).toEqual({ data: [{ code: 'X' }] });
  });

  it('listEvents y getEvent delegan con el tenant parseado', async () => {
    const { controller, service } = build();
    await controller.listEvents('1', { status: 'PENDING' } as never);
    expect(service.listEvents).toHaveBeenCalledWith(tenantIdFromHeader('1'), { status: 'PENDING' });
    await controller.getEvent('1', { eventId: '7' } as never);
    expect(service.getEvent).toHaveBeenCalledWith(tenantIdFromHeader('1'), '7');
  });

  it('createEvent delega con tenant/body/idempotencyKey', async () => {
    const { controller, service } = build();
    const body = { eventCode: 'X', payload: {} } as never;
    await controller.createEvent('1', key, body);
    expect(service.publishFromDto).toHaveBeenCalledWith({ tenantId: tenantIdFromHeader('1'), body, idempotencyKey: requireIdempotencyKey(key) });
  });

  it('createEvent exige el x-idempotency-key', () => {
    const { controller, service } = build();
    expect(() => controller.createEvent('1', undefined, { eventCode: 'X' } as never)).toThrow();
    expect(service.publishFromDto).not.toHaveBeenCalled();
  });

  it('retryEvent y cancelEvent delegan y exigen idempotency-key', async () => {
    const { controller, service } = build();
    await controller.retryEvent('1', key, { eventId: '7' } as never);
    expect(service.retryEvent).toHaveBeenCalledWith(tenantIdFromHeader('1'), '7');
    await controller.cancelEvent('1', key, { eventId: '7' } as never);
    expect(service.cancelEvent).toHaveBeenCalledWith(tenantIdFromHeader('1'), '7');
    expect(() => controller.retryEvent('1', undefined, { eventId: '7' } as never)).toThrow();
  });
});
