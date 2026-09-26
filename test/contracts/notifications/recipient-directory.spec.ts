/**
 * @file AT-039 — Mensajería obtiene direcciones de entrega por el puerto de Clientes, autorizadas por propósito.
 * @business Contacto borrado/no verificado: no se entrega; mismo id en otro tenant: nada; propósito no
 *   permitido: nada; directorio caído: error propagado (entrega reintentable), no dato arbitrario.
 * @system Adaptador de Clientes con doble del repositorio y cifrado envelope real; adaptador de Mensajería encima.
 */
import { describe, expect, it } from '@jest/globals';
import { encryptSecretEnvelope } from '../../../src/common/utils/crypto/envelope-encryption.util.js';
import { CustomerRecipientDirectoryAdapter } from '../../../src/modules/customers/infrastructure/customer-recipient-directory.adapter.js';
import { LocalRecipientDirectoryAdapter } from '../../../src/modules/notifications/infrastructure/directory/local-recipient-directory.adapter.js';

async function method(id: string, contactType: string, status: string, value: string, extra: Record<string, unknown> = {}) {
  return { id, contactType, status, deleted: false, isPrimary: false, contactValueEncrypted: await encryptSecretEnvelope(value), ...extra };
}

function build(byTenant: Record<string, Record<string, unknown>[]>) {
  const contacts = { findContactMethods: async (tenantId: string) => byTenant[tenantId] ?? [] };
  const customers = new CustomerRecipientDirectoryAdapter(contacts as never);
  return { customers, messaging: new LocalRecipientDirectoryAdapter(customers) };
}

describe('directorio de destinatarios (AT-039)', () => {
  it('contacto verificado y propósito transaccional: dirección descifrada, sin modelo', async () => {
    const { messaging } = build({ '1': [await method('7', 'phone', 'verified', '+59170000001')] });
    const targets = await messaging.resolveTargets({ tenantId: '1', customerId: '42', channel: 'sms' });
    expect(targets).toEqual([{ kind: 'phone', address: '+59170000001' }]);
  });

  it('contacto cambiado (borrado) o no verificado: no se entrega a un destinatario prohibido por política', async () => {
    const { messaging } = build({
      '1': [
        await method('7', 'phone', 'verified', '+59170000001', { deleted: true }),
        await method('8', 'phone', 'pending', '+59170000002'),
      ],
    });
    expect(await messaging.resolveTargets({ tenantId: '1', customerId: '42', channel: 'sms' })).toEqual([]);
  });

  it('el propósito otp acepta el contacto aún no verificado (es cómo se verifica); marketing no está autorizado', async () => {
    const { customers } = build({ '1': [await method('8', 'email', 'pending', 'ana@example.test')] });
    const lookup = { tenantId: '1', recipient: { type: 'customer' as const, id: '42' }, channel: 'email' as const };
    expect((await customers.resolveDeliveryAddresses({ ...lookup, purpose: 'otp' })).map((a) => a.address)).toEqual(['ana@example.test']);
    expect(await customers.resolveDeliveryAddresses({ ...lookup, purpose: 'marketing' })).toEqual([]);
  });

  it('mismo id en tenant incorrecto: no devuelve dirección', async () => {
    const { messaging } = build({ '1': [await method('7', 'phone', 'verified', '+59170000001')] });
    expect(await messaging.resolveTargets({ tenantId: '2', customerId: '42', channel: 'sms' })).toEqual([]);
  });

  it('directorio indisponible: el error se propaga (resultado definido y reintentable), nunca envío a dato arbitrario', async () => {
    const failing = {
      resolveDeliveryAddresses: async () => {
        throw new Error('directorio caído');
      },
      resolve: async () => {
        throw new Error('x');
      },
    };
    await expect(
      new LocalRecipientDirectoryAdapter(failing as never).resolveTargets({ tenantId: '1', customerId: '42', channel: 'email' }),
    ).rejects.toThrow('directorio caído');
  });

  it('canales sin contacto (push, in_app) no consultan el directorio', async () => {
    const { messaging } = build({});
    expect(await messaging.resolveTargets({ tenantId: '1', customerId: '42', channel: 'push' })).toEqual([]);
  });
});
