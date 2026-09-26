import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ResilientAdapterExecutorService } from '../../../src/common/resilience/resilient-adapter-executor.service.js';
import { SmsNotificationAdapter } from '../../../src/modules/notifications/adapters/sms.adapter.js';
import { WhatsAppNotificationAdapter } from '../../../src/modules/notifications/adapters/whatsapp.adapter.js';

/**
 * Las dos ramas de Brevo, contra un `fetch` mockeado y el executor REAL.
 *
 * Se mira la petición que sale, no sólo el resultado, porque lo que Brevo hace distinto de Twilio no
 * produce errores: produce envíos que el proveedor acepta y que no llegan a nadie. Son cuatro cosas
 * —el destinatario sin `+`, la clave en su propia cabecera `api-key`, la URL de estado DENTRO del
 * envío y la plantilla obligatoria de WhatsApp— y ninguna la ve `tsc` ni un test de resultado.
 */
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

/** Lo que el adaptador acabó pidiendo: URL, cabeceras y cuerpo ya parseado. */
type PeticionCapturada = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function capturarFetch(respuesta: { status: number; json: Record<string, unknown> }): { peticiones: PeticionCapturada[] } {
  const peticiones: PeticionCapturada[] = [];
  global.fetch = jest.fn(async (url: unknown, init: unknown) => {
    const opciones = init as { headers: Record<string, string>; body: string };
    peticiones.push({ url: String(url), headers: opciones.headers, body: JSON.parse(opciones.body) as Record<string, unknown> });
    return new Response(JSON.stringify(respuesta.json), { status: respuesta.status });
  }) as unknown as typeof fetch;
  return { peticiones };
}

describe('Brevo — SMS', () => {
  function build(overrides: Record<string, unknown> = {}) {
    const config = {
      getSmsProvider: () => 'brevo',
      getBrevoSmsConfig: () => ({
        ok: true,
        value: {
          apiKey: 'clave-de-brevo',
          sender: 'ATLAS',
          statusCallbackUrl: 'https://api.atlas.test/api/v1/internal/notifications/brevo-sms-events/secreto',
          defaultCountryCode: '+591',
        },
      }),
      ...overrides,
    };
    return new SmsNotificationAdapter(config as never, new ResilientAdapterExecutorService());
  }

  const msg = (payload: Record<string, unknown> = { phone: '70000000' }) =>
    ({ id: '1', channel: 'sms', body: 'Tu código es 482913.', payload }) as never;

  it('destinatario en E.164 SIN «+», clave en la cabecera api-key y URL de estado dentro del envío', async () => {
    const { peticiones } = capturarFetch({ status: 201, json: { messageId: 1511882900100020 } });

    const resultado = await build().send(msg());

    expect(peticiones).toHaveLength(1);
    const [peticion] = peticiones;
    expect(peticion.url).toBe('https://api.brevo.com/v3/transactionalSMS/send');
    expect(peticion.headers['api-key']).toBe('clave-de-brevo');
    // El número nacional se completa con el país y pierde el «+»: Brevo rechaza las dos formas.
    expect(peticion.body.recipient).toBe('59170000000');
    expect(peticion.body.sender).toBe('ATLAS');
    expect(peticion.body.type).toBe('transactional');
    expect(peticion.body.webUrl).toContain('/brevo-sms-events/secreto');
    // El identificador llega como NÚMERO y se guarda como texto: si no, el callback no cruzaría.
    expect(resultado).toMatchObject({ status: 'sent', provider: 'brevo_sms', providerMessageId: '1511882900100020' });
  });

  it('sin URL de estado configurada no manda webUrl, en vez de mandarla vacía', async () => {
    const { peticiones } = capturarFetch({ status: 201, json: { messageId: 7 } });
    const adapter = build({
      getBrevoSmsConfig: () => ({
        ok: true,
        value: { apiKey: 'k', sender: 'ATLAS', statusCallbackUrl: null, defaultCountryCode: '+591' },
      }),
    });

    expect((await adapter.send(msg())).providerMessageId).toBe('7');
    expect(peticiones[0].body).not.toHaveProperty('webUrl');
  });

  it('sin configuración contesta qué falta y no llama a nadie, en vez de lanzar', async () => {
    const { peticiones } = capturarFetch({ status: 201, json: {} });
    const adapter = build({ getBrevoSmsConfig: () => ({ ok: false, missing: 'BREVO_API_KEY_MISSING' }) });

    expect(await adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'BREVO_API_KEY_MISSING' });
    expect(peticiones).toHaveLength(0);
  });

  it('un destinatario sin forma de teléfono se rechaza antes de gastar un envío', async () => {
    const { peticiones } = capturarFetch({ status: 201, json: {} });
    expect(await build().send(msg({ phone: '12' }))).toMatchObject({ status: 'failed', errorCode: 'INVALID_SMS_RECIPIENT' });
    expect(peticiones).toHaveLength(0);
  });

  it('distingue el rechazo permanente del fallo reintentable por el code de Brevo, no por el status', async () => {
    capturarFetch({ status: 400, json: { code: 'invalid_parameter', message: "Invalid 'recipient'" } });
    expect(await build().send(msg())).toMatchObject({ status: 'failed', errorCode: 'BREVO_SMS_RECIPIENT_REJECTED' });

    capturarFetch({ status: 400, json: { code: 'duplicate_parameter', message: 'ya existe' } });
    expect(await build().send(msg())).toMatchObject({ status: 'failed', errorCode: 'BREVO_SMS_SEND_FAILED' });
  });
});

describe('Brevo — WhatsApp', () => {
  function build(overrides: Record<string, unknown> = {}) {
    const config = {
      getWhatsAppProvider: () => 'brevo',
      getBrevoWhatsAppConfig: () => ({
        ok: true,
        value: { apiKey: 'clave-de-brevo', senderNumber: '59170000000', defaultTemplateId: 7, defaultCountryCode: '+591' },
      }),
      ...overrides,
    };
    return new WhatsAppNotificationAdapter(config as never, new ResilientAdapterExecutorService());
  }

  const msg = (payload: Record<string, unknown> = { phone: '70000000' }) =>
    ({ id: '1', channel: 'whatsapp', body: 'Tu código es 482913.', payload }) as never;

  it('envía por plantilla, con el destinatario en una lista y los huecos con nombre', async () => {
    const { peticiones } = capturarFetch({ status: 201, json: { messageId: 'wam-1' } });

    const resultado = await build().send(msg({ phone: '70000000', whatsappTemplateParams: { codigo: '482913', minutos: '10' } }));

    expect(peticiones[0].url).toBe('https://api.brevo.com/v3/whatsapp/sendMessage');
    expect(peticiones[0].headers['api-key']).toBe('clave-de-brevo');
    expect(peticiones[0].body.contactNumbers).toEqual(['59170000000']);
    expect(peticiones[0].body.templateId).toBe(7);
    expect(peticiones[0].body.params).toEqual({ codigo: '482913', minutos: '10' });
    expect(resultado).toMatchObject({ status: 'sent', provider: 'brevo_whatsapp', providerMessageId: 'wam-1' });
  });

  it('la lista posicional de Meta se traduce a huecos numerados en vez de perderse', async () => {
    const { peticiones } = capturarFetch({ status: 201, json: { messageId: 'wam-2' } });
    await build().send(msg({ phone: '70000000', whatsappTemplateParameters: ['482913', 10] }));
    expect(peticiones[0].body.params).toEqual({ '1': '482913', '2': '10' });
  });

  it('sin plantilla no envía: un WhatsApp iniciado por la empresa sin plantilla lo rechaza Meta', async () => {
    const { peticiones } = capturarFetch({ status: 201, json: {} });
    const adapter = build({
      getBrevoWhatsAppConfig: () => ({
        ok: true,
        value: { apiKey: 'k', senderNumber: '59170000000', defaultTemplateId: null, defaultCountryCode: '+591' },
      }),
    });

    expect(await adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'BREVO_WHATSAPP_TEMPLATE_MISSING' });
    expect(peticiones).toHaveLength(0);
  });

  it('la plantilla del mensaje gana a la del entorno', async () => {
    const { peticiones } = capturarFetch({ status: 201, json: { messageId: 'wam-3' } });
    await build().send(msg({ phone: '70000000', whatsappTemplateId: 99 }));
    expect(peticiones[0].body.templateId).toBe(99);
  });

  it('un prefijo «whatsapp:» del destinatario no viaja a Brevo', async () => {
    const { peticiones } = capturarFetch({ status: 201, json: { messageId: 'wam-4' } });
    await build().send(msg({ whatsappTo: 'whatsapp:+59170000000' }));
    expect(peticiones[0].body.contactNumbers).toEqual(['59170000000']);
  });

  it('sin configuración contesta qué falta, no lanza', async () => {
    const adapter = build({ getBrevoWhatsAppConfig: () => ({ ok: false, missing: 'BREVO_WHATSAPP_SENDER_NUMBER_MISSING' }) });
    expect(await adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'BREVO_WHATSAPP_SENDER_NUMBER_MISSING' });
  });
});
