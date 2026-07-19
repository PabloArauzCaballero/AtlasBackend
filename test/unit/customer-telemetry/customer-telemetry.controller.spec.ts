import { describe, expect, it, jest } from '@jest/globals';
import { CustomerTelemetryController } from '../../../src/modules/customer-telemetry/customer-telemetry.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';

/**
 * `CustomerTelemetryController.ingestBatch` recibe el batch de telemetría on-device. Ramas propias:
 * exigencia de x-idempotency-key e IP desde el request (null si falta). Spec directo con el servicio
 * mockeado.
 */
describe('CustomerTelemetryController', () => {
  function build() {
    const service = { ingestBatch: jest.fn(async () => ({ eventsProcessed: 3, metricsProcessed: 2 })) };
    return { controller: new CustomerTelemetryController(service as never), service };
  }
  const params = { customerId: '9' } as never;
  const user = { role: 'customer', tenantId: '1', customerId: '9' } as never;

  it('ingestBatch delega con tenant/customerId/idempotencyKey e IP del request', async () => {
    const { controller, service } = build();
    const body = { events: [], metrics: [] } as never;
    await controller.ingestBatch('1', 'idem', params, body, user, { ip: '8.8.8.8' } as never);
    expect(service.ingestBatch).toHaveBeenCalledWith({
      tenantId: tenantIdFromHeader('1'),
      customerId: '9',
      body,
      currentUser: user,
      idempotencyKey: 'idem',
      ipAddress: '8.8.8.8',
    });
  });

  it('usa null como IP cuando el request no la trae', async () => {
    const { controller, service } = build();
    await controller.ingestBatch('1', 'idem', params, { events: [] } as never, user, {} as never);
    expect((service.ingestBatch.mock.calls[0][0] as { ipAddress: string | null }).ipAddress).toBeNull();
  });

  it('exige el x-idempotency-key', () => {
    const { controller, service } = build();
    expect(() => controller.ingestBatch('1', undefined, params, {} as never, user, {} as never)).toThrow();
    expect(service.ingestBatch).not.toHaveBeenCalled();
  });
});
