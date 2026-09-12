/**
 * @file AT-040/AT-044 — contrato común de canales: capacidades declaradas, sin soporte falso, fallo cerrado.
 * @business Un canal declara qué soporta; el que no soporta un canal lo dice; un proveedor apagado no
 *   «envía» con éxito; la sustitución por un fake cumple la misma especificación.
 * @system La misma batería corre contra los adaptadores reales en modo `disabled` y contra un fake.
 */
import { describe, expect, it } from '@jest/globals';
import type { NotificationChannelAdapter } from '../../../src/modules/notifications/adapters/notification-channel-adapter.js';
import { SmsNotificationAdapter } from '../../../src/modules/notifications/adapters/sms.adapter.js';
import { WhatsAppNotificationAdapter } from '../../../src/modules/notifications/adapters/whatsapp.adapter.js';

const disabledConfig = { getSmsProvider: () => 'disabled', getWhatsAppProvider: () => 'disabled', getWhatsappProvider: () => 'disabled' };
const executor = {
  execute: async () => {
    throw new Error('no debe ejecutarse con proveedor apagado');
  },
};

function fakeAdapter(): NotificationChannelAdapter {
  return {
    getProviderName: () => 'fake',
    supports: (c) => c === 'sms',
    validatePayload: (m) => Boolean(m.deliveryTargets?.length),
    send: async () => ({ status: 'sent', provider: 'fake' }),
  };
}

function contract(name: string, factory: () => NotificationChannelAdapter, own: 'sms' | 'whatsapp') {
  describe(`contrato de canal · ${name}`, () => {
    it('declara su proveedor y su canal; no finge soportar otros', () => {
      const adapter = factory();
      expect(typeof adapter.getProviderName()).toBe('string');
      expect(adapter.supports(own)).toBe(true);
      expect(adapter.supports('push')).toBe(false);
    });
    it('validatePayload es una decisión explícita (booleana) sobre el payload; el fake rechaza sin destinos', () => {
      const verdict = factory().validatePayload({
        id: 'x',
        tenantId: '1',
        recipientType: 'customer',
        recipientId: '1',
        channel: own,
        subject: null,
        title: null,
        body: '',
        payload: {},
        correlationId: null,
        deliveryTargets: [],
      });
      expect(typeof verdict).toBe('boolean');
      if (name.startsWith('fake')) expect(verdict).toBe(false);
    });

    it('el resultado de send es un DeliveryResult con estado y proveedor, nunca un éxito vacío', async () => {
      const result = await factory().send({
        id: 'x',
        tenantId: '1',
        recipientType: 'customer',
        recipientId: '1',
        channel: own,
        subject: null,
        title: 'T',
        body: 'b',
        payload: {},
        correlationId: null,
        deliveryTargets: [{ kind: own === 'sms' ? 'phone' : 'whatsapp', address: '+59170000001' }],
      });
      expect(['sent', 'delivered', 'failed', 'skipped']).toContain(result.status);
      expect(typeof result.provider).toBe('string');
      if (result.provider.includes('disabled')) expect(result.status).toBe('failed');
    });
  });
}

contract(
  'SMS real (proveedor apagado → fallo cerrado)',
  () => new SmsNotificationAdapter(disabledConfig as never, executor as never),
  'sms',
);
contract(
  'WhatsApp real (proveedor apagado → fallo cerrado)',
  () => new WhatsAppNotificationAdapter(disabledConfig as never, executor as never),
  'whatsapp',
);
contract('fake de pruebas', fakeAdapter, 'sms');
