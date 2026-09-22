/**
 * @file AT-040 — contrato de entrega de OTP: vencimiento, capacidades, resultado incierto.
 * @business Un OTP vencido no se entrega; el proveedor aceptó y la respuesta se perdió → incierto, sin
 *   código nuevo; canal apagado → error explícito, nunca éxito vacío.
 * @system Adaptador local con dobles de MailSender y canales; el servicio de verificación delega en el puerto.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ContactVerificationCodeService } from '../../../src/modules/customer-onboarding/application/contact-verification-code.service.js';
import {
  LocalOtpDeliveryAdapter,
  classifyDeliveryError,
} from '../../../src/modules/notifications/infrastructure/local-otp-delivery.adapter.js';
import { OTP_ERRORS } from '../../../src/modules/notifications/public/index.js';

function build(options: { mailEnabled?: boolean; sms?: string; smsSend?: () => Promise<unknown> } = {}) {
  const mail = {
    isEnabled: () => options.mailEnabled ?? true,
    // Tipado con su argumento para poder afirmar A QUIÉN se le mandó: con `jest.fn(async () => ...)`
    // el doble declara cero parámetros y `toHaveBeenCalledWith` no compila.
    sendContactVerificationCode: jest.fn(
      async (_entrada: { to: string; code: string; ttlMinutes: number; reference: string }) => undefined,
    ),
  };
  const sms = {
    getProviderName: () => options.sms ?? 'webhook',
    send: jest.fn(options.smsSend ?? (async () => ({ status: 'sent', provider: 'webhook' }))),
  };
  const whatsapp = { getProviderName: () => 'disabled', send: jest.fn() };
  return { adapter: new LocalOtpDeliveryAdapter(mail as never, sms as never, whatsapp as never), mail, sms };
}
const base = {
  tenantId: '1',
  customerId: '42',
  destination: '+59170000001',
  code: '123456',
  ttlMinutes: 10,
  reference: 'contact-verification:42',
  now: new Date('2026-09-12T00:00:00.000Z'),
};

describe('OtpDeliveryPort (AT-040)', () => {
  it('OTP vencido antes del envío: no se entrega como vigente y el proveedor no se llama', async () => {
    const { adapter, sms } = build();
    const outcome = await adapter.deliver({ ...base, channel: 'sms', expiresAt: new Date('2026-09-11T23:59:59.000Z') });
    expect(outcome).toEqual({ delivered: false, provider: 'none', errorCode: OTP_ERRORS.expired, uncertain: false });
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('proveedor aceptó y la respuesta se perdió (timeout): resultado INCIERTO, no un fallo que invite a otro código', async () => {
    const { adapter } = build({
      smsSend: async () => {
        throw new Error('request timed out after 5000 ms');
      },
    });
    const outcome = await adapter.deliver({ ...base, channel: 'sms', expiresAt: new Date('2026-09-12T00:10:00.000Z') });
    expect(outcome).toMatchObject({ delivered: false, uncertain: true, errorCode: OTP_ERRORS.uncertain });
    expect(classifyDeliveryError(new Error('ECONNRESET'))).toEqual({ errorCode: OTP_ERRORS.uncertain, uncertain: true });
    expect(classifyDeliveryError(new Error('invalid number'))).toEqual({ errorCode: OTP_ERRORS.failed, uncertain: false });
  });

  it('canal no soportado (apagado): error explícito, nunca éxito vacío', async () => {
    const { adapter } = build();
    const outcome = await adapter.deliver({ ...base, channel: 'whatsapp', expiresAt: new Date('2026-09-12T00:10:00.000Z') });
    expect(outcome).toMatchObject({ delivered: false, errorCode: OTP_ERRORS.unsupported });
    expect(adapter.capabilities().find((c) => c.channel === 'whatsapp')?.available).toBe(false);
  });

  it('el servicio de verificación delega en el puerto y conserva su contrato de respuesta', async () => {
    const { adapter } = build({ mailEnabled: false });
    const service = new ContactVerificationCodeService({} as never, {} as never, {} as never, {} as never, {} as never, adapter);
    expect(service.availableChannels()).toEqual(['sms']);
    const outcome = await service.deliverIssuedCode({
      tenantId: '1',
      customerId: '42',
      channel: 'sms',
      issued: { code: '123456', ttlMinutes: 10, destination: '+59170000001' },
    });
    // `channel` dice por dónde salió DE VERDAD: aquí coincide con el pedido, y con la reserva por
    // correo encendida podría no hacerlo. Ver «la reserva por correo» más abajo.
    expect(outcome).toEqual({ delivered: true, provider: 'webhook', errorCode: null, channel: 'sms' });
  });
});

/*
 * La reserva por correo (2026-09-21).
 *
 * Nació de un día entero de alta parada en TEST: la cuenta de Brevo no tenía crédito de SMS, así
 * que aceptaba cada envío con un `201` y lo descartaba después —25 `rejected`, 0 entregados—. Con
 * el saldo comprobado antes de enviar, ese caso llega aquí como un envío FALLIDO, y esto es lo que
 * decide si el código puede salir por el correo del mismo cliente en vez de perderse.
 */
describe('Reserva por correo cuando el canal pedido no entrega', () => {
  const conReserva = { ...base, channel: 'sms' as const, expiresAt: new Date('2026-09-12T00:10:00.000Z'), fallbackEmail: 'yo@atlas.bo' };

  it('el SMS falla y hay correo autorizado: el código sale por correo y se dice cuál fue', async () => {
    const { adapter, mail } = build({
      smsSend: async () => ({ status: 'failed', provider: 'brevo_sms', errorCode: 'BREVO_SMS_NO_CREDITS' }),
    });
    const outcome = await adapter.deliver(conReserva);
    expect(outcome).toEqual({ delivered: true, provider: 'mailsender', errorCode: null, uncertain: false, channel: 'email' });
    expect(mail.sendContactVerificationCode).toHaveBeenCalledWith(expect.objectContaining({ to: 'yo@atlas.bo', code: '123456' }));
  });

  it('sin correo autorizado el fallo sigue siendo un fallo: nadie adivina una dirección', async () => {
    const { adapter, mail } = build({
      smsSend: async () => ({ status: 'failed', provider: 'brevo_sms', errorCode: 'BREVO_SMS_NO_CREDITS' }),
    });
    const outcome = await adapter.deliver({ ...conReserva, fallbackEmail: null });
    expect(outcome).toMatchObject({ delivered: false, errorCode: 'BREVO_SMS_NO_CREDITS' });
    expect(mail.sendContactVerificationCode).not.toHaveBeenCalled();
  });

  it('un envío que SALIÓ no dispara la reserva: dos códigos por dos canales dejan sin saber cuál escribir', async () => {
    const { adapter, mail } = build();
    const outcome = await adapter.deliver(conReserva);
    expect(outcome).toMatchObject({ delivered: true, channel: 'sms' });
    expect(mail.sendContactVerificationCode).not.toHaveBeenCalled();
  });

  it('un resultado INCIERTO tampoco la dispara: el proveedor pudo haber aceptado', async () => {
    const { adapter, mail } = build({
      smsSend: async () => {
        throw new Error('socket hang up');
      },
    });
    const outcome = await adapter.deliver(conReserva);
    expect(outcome).toMatchObject({ delivered: false, uncertain: true });
    expect(mail.sendContactVerificationCode).not.toHaveBeenCalled();
  });

  it('el canal caído es el propio correo: repetirlo sería repetir el fallo', async () => {
    const { adapter, mail } = build({ mailEnabled: true });
    mail.sendContactVerificationCode.mockRejectedValueOnce(new Error('gmail 500') as never);
    const outcome = await adapter.deliver({ ...conReserva, channel: 'email', destination: 'yo@atlas.bo' });
    expect(outcome).toMatchObject({ delivered: false });
    expect(mail.sendContactVerificationCode).toHaveBeenCalledTimes(1);
  });

  it('si la reserva tampoco sale, gana el fallo ORIGINAL: es el que explica por qué no llegó nada', async () => {
    const { adapter, mail } = build({
      smsSend: async () => ({ status: 'failed', provider: 'brevo_sms', errorCode: 'BREVO_SMS_NO_CREDITS' }),
    });
    mail.sendContactVerificationCode.mockRejectedValueOnce(new Error('gmail 500') as never);
    const outcome = await adapter.deliver(conReserva);
    expect(outcome).toMatchObject({ delivered: false, errorCode: 'BREVO_SMS_NO_CREDITS' });
  });

  it('el canal apagado también tiene reserva: un proveedor en `disabled` no deja el alta sin salida', async () => {
    const { adapter, mail } = build({ sms: 'disabled' });
    const outcome = await adapter.deliver(conReserva);
    expect(outcome).toMatchObject({ delivered: true, channel: 'email' });
    expect(mail.sendContactVerificationCode).toHaveBeenCalledTimes(1);
  });
});
