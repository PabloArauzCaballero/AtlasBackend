/**
 * @file AT-020 — contrato de lectura entre contextos: el directorio de destinatarios.
 * @business Mensajería sabe si puede avisar a un cliente por un canal sin leer su tabla de contactos;
 *   la ausencia de contacto es un estado definido, no una autorización implícita.
 * @system Adaptador real de Clientes con un doble del repositorio. Lo que se fija: sólo valores
 *   (identificador opaco, estado, instante), nunca el teléfono ni el correo; canales sin contacto
 *   resuelven `available`; destinatarios no soportados resuelven `unsupported`.
 */
import { describe, expect, it } from '@jest/globals';
import { CustomerRecipientDirectoryAdapter } from '../../../src/modules/customers/infrastructure/customer-recipient-directory.adapter.js';

type Method = { id: string; contactType: string; status: string; deleted: boolean; valueEncrypted?: string };

function build(methods: Method[]) {
  const repository = {
    findContactMethods: async () => methods.map((method) => ({ ...method, valueEncrypted: 'CIFRADO', save: () => undefined })),
  };
  return new CustomerRecipientDirectoryAdapter(repository as never);
}

const lookup = (channel: 'email' | 'sms' | 'whatsapp' | 'phone' | 'in_app' | 'push', type: 'customer' | 'merchant' = 'customer') => ({
  tenantId: '1',
  recipient: { type, id: '42' },
  channel,
});

describe('RecipientDirectoryPort · adaptador de Clientes', () => {
  it('contacto verificado: available con identificador opaco, sin el valor en claro', async () => {
    const adapter = build([{ id: '7', contactType: 'phone', status: 'verified', deleted: false }]);
    const result = await adapter.resolve(lookup('sms'));
    expect(result).toMatchObject({ status: 'available', contactId: '7' });
    expect(JSON.stringify(result)).not.toContain('CIFRADO');
    expect(Object.keys(result).sort()).toEqual(['contactId', 'resolvedAt', 'status']);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('contacto existente pero no verificado: unverified, y quien consume decide (no envía como si estuviera vigente)', async () => {
    const adapter = build([{ id: '8', contactType: 'email', status: 'pending', deleted: false }]);
    expect((await adapter.resolve(lookup('email'))).status).toBe('unverified');
  });

  it('sin contacto (o borrado): absent — la ausencia no se confunde con autorización', async () => {
    expect((await build([]).resolve(lookup('email'))).status).toBe('absent');
    expect((await build([{ id: '9', contactType: 'email', status: 'verified', deleted: true }]).resolve(lookup('email'))).status).toBe(
      'absent',
    );
  });

  it('canales que no necesitan contacto (in_app, push) resuelven available sin consultar contactos', async () => {
    const adapter = build([]);
    expect((await adapter.resolve(lookup('in_app'))).status).toBe('available');
    expect((await adapter.resolve(lookup('push'))).status).toBe('available');
  });

  it('un destinatario que Clientes no gobierna resuelve unsupported, no absent', async () => {
    expect((await build([]).resolve(lookup('sms', 'merchant'))).status).toBe('unsupported');
  });

  it('la respuesta lleva el instante de lectura: quien consume sabe cuán fresca es', async () => {
    const before = Date.now();
    const result = await build([]).resolve(lookup('email'));
    expect(new Date(result.resolvedAt).getTime()).toBeGreaterThanOrEqual(before);
  });
});
