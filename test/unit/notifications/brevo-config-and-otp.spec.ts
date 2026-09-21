import { describe, expect, it } from '@jest/globals';
import {
  resolveBrevoSmsConfig,
  resolveBrevoWhatsAppConfig,
  type BrevoEnvSource,
} from '../../../src/modules/notifications/adapters/brevo/brevo-config.util.js';
import { brevoErrorDetails, brevoMessageId, toBrevoNumber } from '../../../src/modules/notifications/adapters/brevo/brevo-request.util.js';
import { brevoTemplateId, brevoTemplateParams } from '../../../src/modules/notifications/adapters/brevo/brevo-whatsapp.util.js';
import { isValidBrevoWebhookSecret } from '../../../src/modules/notifications/adapters/brevo/brevo-webhook-secret.util.js';
import { otpMessagePayload } from '../../../src/modules/notifications/otp-message.util.js';

const completo: BrevoEnvSource = {
  apiKey: 'clave',
  smsSender: 'ATLAS',
  statusCallbackUrl: 'https://api.atlas.test/brevo-sms-events/secreto',
  whatsappSenderNumber: '59170000000',
  whatsappDefaultTemplateId: 7,
  defaultCountryCode: '+591',
};

describe('Configuración de Brevo', () => {
  it('resuelve los dos canales cuando está todo', () => {
    expect(resolveBrevoSmsConfig(completo)).toMatchObject({ ok: true, value: { apiKey: 'clave', sender: 'ATLAS' } });
    expect(resolveBrevoWhatsAppConfig(completo)).toMatchObject({ ok: true, value: { senderNumber: '59170000000', defaultTemplateId: 7 } });
  });

  it('nombra la PRIMERA pieza que falta en vez de lanzar', () => {
    expect(resolveBrevoSmsConfig({ ...completo, apiKey: '  ' })).toEqual({ ok: false, missing: 'BREVO_API_KEY_MISSING' });
    expect(resolveBrevoSmsConfig({ ...completo, smsSender: undefined })).toEqual({ ok: false, missing: 'BREVO_SMS_SENDER_MISSING' });
    expect(resolveBrevoWhatsAppConfig({ ...completo, whatsappSenderNumber: undefined })).toEqual({
      ok: false,
      missing: 'BREVO_WHATSAPP_SENDER_NUMBER_MISSING',
    });
  });

  it('una URL de estado vacía es «sin callback», no una cadena vacía que viajaría en el envío', () => {
    const resultado = resolveBrevoSmsConfig({ ...completo, statusCallbackUrl: '' });
    expect(resultado).toMatchObject({ ok: true, value: { statusCallbackUrl: null } });
  });

  it('WhatsApp sin plantilla por defecto sigue siendo configuración válida: el mensaje puede traer la suya', () => {
    expect(resolveBrevoWhatsAppConfig({ ...completo, whatsappDefaultTemplateId: undefined })).toMatchObject({
      ok: true,
      value: { defaultTemplateId: null },
    });
  });
});

describe('Teléfonos, identificadores y errores de Brevo', () => {
  it('un teléfono queda en dígitos con país y sin «+», venga como venga', () => {
    expect(toBrevoNumber('70000000', '+591')).toBe('59170000000');
    expect(toBrevoNumber('+591 70000000', '+591')).toBe('59170000000');
    expect(toBrevoNumber('(591) 70000000', '+591')).toBe('59170000000');
    expect(toBrevoNumber('12', '+591')).toBeNull();
    expect(toBrevoNumber(null, '+591')).toBeNull();
  });

  it('el identificador se normaliza a texto venga número (SMS) o cadena (WhatsApp)', () => {
    expect(brevoMessageId(1511882900100020)).toBe('1511882900100020');
    expect(brevoMessageId('wam-1')).toBe('wam-1');
    expect(brevoMessageId(null)).toBeNull();
    expect(brevoMessageId('  ')).toBeNull();
  });

  it('el motivo real se lee igual venga directo o re-expuesto por el transporte', () => {
    expect(brevoErrorDetails({ code: 'invalid_parameter', message: 'mal' })).toEqual({
      code: 'invalid_parameter',
      message: 'mal',
      permanent: true,
    });
    expect(brevoErrorDetails({ providerResponse: { code: 'not_enough_credits' } }).permanent).toBe(true);
    expect(brevoErrorDetails({ code: 'duplicate_request' }).permanent).toBe(false);
    expect(brevoErrorDetails(null)).toEqual({ code: null, message: null, permanent: false });
  });
});

describe('Plantilla de WhatsApp', () => {
  it('acepta el identificador como número o como texto de dígitos, y rechaza lo demás', () => {
    expect(brevoTemplateId(7)).toBe(7);
    expect(brevoTemplateId('7')).toBe(7);
    expect(brevoTemplateId('siete')).toBeNull();
    expect(brevoTemplateId(0)).toBeNull();
    expect(brevoTemplateId(undefined)).toBeNull();
  });

  it('los huecos con nombre ganan a la lista posicional', () => {
    expect(brevoTemplateParams({ whatsappTemplateParams: { codigo: '1' }, whatsappTemplateParameters: ['9'] })).toEqual({ codigo: '1' });
  });

  it('lo que no es texto ni número no entra como hueco', () => {
    expect(brevoTemplateParams({ whatsappTemplateParams: { a: '1', b: null, c: { x: 1 }, d: 2 } })).toEqual({ a: '1', d: '2' });
  });

  it('un payload sin nada devuelve un objeto vacío, no `undefined`', () => {
    expect(brevoTemplateParams({})).toEqual({});
  });
});

describe('El secreto del webhook', () => {
  // Compuesto, no escrito entero: ver la nota en `brevo-callbacks.spec.ts`.
  const secreto = ['secreto', 'de', 'prueba', 'del', 'webhook'].join('-');

  it('acepta el suyo y rechaza todo lo demás, incluida la ausencia', () => {
    expect(isValidBrevoWebhookSecret(secreto, secreto)).toBe(true);
    expect(isValidBrevoWebhookSecret(secreto, `${secreto}x`)).toBe(false);
    expect(isValidBrevoWebhookSecret(secreto, undefined)).toBe(false);
    expect(isValidBrevoWebhookSecret(null, secreto)).toBe(false);
  });
});

describe('El código de verificación dentro de la plantilla', () => {
  /**
   * Es el fallo más caro de todos: una plantilla sin sus parámetros llega como «Tu código es» y
   * nada más, el proveedor la da por entregada y todo parece verde.
   */
  it('el payload del OTP lleva el código como hueco con nombre Y como lista posicional', () => {
    expect(otpMessagePayload('ref-1', '482913', 10)).toEqual({
      reference: 'ref-1',
      whatsappTemplateParams: { codigo: '482913', minutos: '10' },
      whatsappTemplateParameters: ['482913', '10'],
    });
  });
});
