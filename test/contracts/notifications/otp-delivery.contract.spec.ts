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
  const mail = { isEnabled: () => options.mailEnabled ?? true, sendContactVerificationCode: jest.fn(async () => undefined) };
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
    expect(outcome).toEqual({ delivered: true, provider: 'webhook', errorCode: null });
  });
});
