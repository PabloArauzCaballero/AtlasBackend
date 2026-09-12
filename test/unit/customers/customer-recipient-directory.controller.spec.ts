/**
 * @file AT-057 — el controlador del directorio entre contextos toma el tenant del TOKEN y no de la petición.
 * @business Quien pregunta es otro contexto con su identidad de servicio; el cliente y el canal vienen en la
 *   query, pero el tenant sale del token. La respuesta es lo que el dueño autoriza, sin añadir nada.
 * @system Controlador real con un doble del adaptador de Clientes; sin HTTP, sin guard (eso lo cubren el
 *   contrato de seguridad y la prueba de integración) y sin base.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CustomerRecipientDirectoryController } from '../../../src/modules/customers/customer-recipient-directory.controller.js';
import type { CustomerRecipientDirectoryAdapter } from '../../../src/modules/customers/infrastructure/customer-recipient-directory.adapter.js';
import type { RequestWithServiceActor } from '../../../src/common/guards/service-token.guard.js';

const actor = (tenantId: string): RequestWithServiceActor => ({
  headers: {},
  serviceActor: { service: 'messaging-worker', tenantId, scopes: ['customers:recipient-directory'], resource: null, jti: 'j-1' },
});

function build() {
  const adapter = {
    resolve: jest.fn(async (..._args: unknown[]) => ({ status: 'available' as const, contactId: '7', resolvedAt: 'x' })),
    resolveDeliveryAddresses: jest.fn(async (..._args: unknown[]) => [
      { contactId: '7', kind: 'phone' as const, address: '+59170000001', resolvedAt: 'x' },
    ]),
  };
  return { adapter, controller: new CustomerRecipientDirectoryController(adapter as unknown as CustomerRecipientDirectoryAdapter) };
}

describe('directorio de destinatarios entre contextos (controlador)', () => {
  it('resolve: el tenant sale del token; el cliente y el canal, de la query', async () => {
    const { controller, adapter } = build();
    const result = await controller.resolve(actor('4'), { customerId: '42', channel: 'sms' });
    expect(result).toMatchObject({ status: 'available', contactId: '7' });
    expect(adapter.resolve).toHaveBeenCalledWith({ tenantId: '4', recipient: { type: 'customer', id: '42' }, channel: 'sms' });
  });

  it('addresses: pasa el propósito al dueño y devuelve sólo lo que éste autoriza, envuelto en `addresses`', async () => {
    const { controller, adapter } = build();
    const result = await controller.addresses(actor('4'), { customerId: '42', channel: 'email', purpose: 'transactional' });
    expect(result).toEqual({ addresses: [{ contactId: '7', kind: 'phone', address: '+59170000001', resolvedAt: 'x' }] });
    expect(adapter.resolveDeliveryAddresses).toHaveBeenCalledWith({
      tenantId: '4',
      recipient: { type: 'customer', id: '42' },
      channel: 'email',
      purpose: 'transactional',
    });
  });

  it('si el dueño no autoriza nada, la respuesta es una lista vacía, no una dirección inventada', async () => {
    const { controller, adapter } = build();
    adapter.resolveDeliveryAddresses.mockImplementationOnce(async () => []);
    expect(await controller.addresses(actor('4'), { customerId: '42', channel: 'sms', purpose: 'marketing' })).toEqual({ addresses: [] });
  });
});
