import { describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Emisión, entrega y verificación del código de contacto.
 *
 * El valor en claro del código viaja una sola vez hacia el proveedor y solo se persiste su hash, con
 * el mismo criterio que el PIN de login y el código de reset. Estos tests fijan esa propiedad y el
 * comportamiento ante vencimiento, intentos agotados y fallo del proveedor.
 */
jest.mock('../../../src/common/utils/crypto/envelope-encryption.util.js', () => ({
  decryptSecretEnvelope: jest.fn(async (..._args: unknown[]) => '+59170000000'),
}));

describe('ContactVerificationCodeService', () => {
  async function build(options: { emailEnabled?: boolean; smsProvider?: string; whatsappProvider?: string } = {}) {
    const { ContactVerificationCodeService, purposeFor } =
      await import('../../../src/modules/customer-onboarding/application/contact-verification-code.service.js');
    const authRepository = {
      createOneTimeCode: jest.fn(async (..._args: unknown[]) => ({ id: 'otc-1' })),
      findActiveOneTimeCodeByActor: jest.fn(async (..._args: unknown[]) => null),
      registerOneTimeCodeFailedAttempt: jest.fn(),
      consumeOneTimeCode: jest.fn(),
    };
    const mailSenderService = {
      isEnabled: jest.fn((..._args: unknown[]) => options.emailEnabled ?? true),
      sendContactVerificationCode: jest.fn(async (..._args: unknown[]) => ({ trackingId: 't1' })),
    };
    const smsAdapter = {
      getProviderName: jest.fn((..._args: unknown[]) => options.smsProvider ?? 'twilio'),
      send: jest.fn(async (..._args: unknown[]) => ({ status: 'sent', provider: 'twilio_sms', errorCode: null })),
    };
    const whatsappAdapter = {
      getProviderName: jest.fn((..._args: unknown[]) => options.whatsappProvider ?? 'disabled'),
      send: jest.fn(async (..._args: unknown[]) => ({ status: 'sent', provider: 'whatsapp', errorCode: null })),
    };
    const service = new ContactVerificationCodeService(
      authRepository as never,
      // Los códigos de un solo uso viven en `AuthOneTimeCodeRepository`; el doble ya los expone.
      authRepository as never,
      mailSenderService as never,
      smsAdapter as never,
      whatsappAdapter as never,
    );
    return { service, authRepository, mailSenderService, smsAdapter, whatsappAdapter, purposeFor };
  }

  const contactMethod = { id: 'contact-1', contactValueEncrypted: 'envelope' } as never;

  it('usa un propósito distinto por tipo de contacto, para que pedir uno no invalide el otro', async () => {
    const { purposeFor } = await build();
    expect(purposeFor('phone')).toBe('contact_verification_phone');
    expect(purposeFor('email')).toBe('contact_verification_email');
  });

  it('solo ofrece los canales que tienen proveedor configurado', async () => {
    const { service } = await build({ emailEnabled: true, smsProvider: 'disabled', whatsappProvider: 'disabled' });
    expect(service.availableChannels()).toEqual(['email']);
    expect(() => service.assertChannelAvailable('sms')).toThrow(ServiceUnavailableException);
    expect(() => service.assertChannelAvailable('email')).not.toThrow();
  });

  /** Emitir + entregar, ahora en dos pasos: el primero transaccional, el segundo tras el commit. */
  async function issueAndDeliver(
    service: { issue: (i: never) => Promise<unknown>; deliverIssuedCode: (i: never) => Promise<unknown> },
    input: { contactMethod: unknown; channel: string },
  ) {
    const issued = await service.issue({
      tenantId: 't1',
      customerId: 'c1',
      contactMethod: input.contactMethod,
      contactType: 'phone',
    } as never);
    return service.deliverIssuedCode({ tenantId: 't1', customerId: 'c1', channel: input.channel, issued } as never);
  }

  it('persiste SOLO el hash del código, nunca su valor en claro', async () => {
    const { service, authRepository, smsAdapter } = await build();

    await issueAndDeliver(service, { contactMethod, channel: 'sms' });

    const stored = (authRepository.createOneTimeCode as jest.Mock).mock.calls[0][0] as { codeHash: string; purpose: string };
    expect(stored.codeHash).toHaveLength(64);
    expect(stored.purpose).toBe('contact_verification_phone');

    // El código en claro sí viaja al proveedor: es la única forma de entregárselo al cliente.
    const sent = (smsAdapter.send as jest.Mock).mock.calls[0][0] as { body: string };
    const codeInBody = /(\d{6})/.exec(sent.body)?.[1];
    expect(codeInBody).toBeDefined();
    expect(stored.codeHash).not.toContain(codeInBody as string);
  });

  /**
   * La emisión se persiste con la transacción del llamador: si el alta del intento hace rollback, el
   * código se va con ella en vez de quedar vigente sin intento asociado.
   */
  it('crea el código dentro de la transacción que le pasan', async () => {
    const { service, authRepository } = await build();
    const transaction = {} as never;

    await service.issue({ tenantId: 't1', customerId: 'c1', contactMethod, contactType: 'phone', transaction } as never);

    expect((authRepository.createOneTimeCode as jest.Mock).mock.calls[0][1]).toEqual({ transaction });
  });

  it('no persiste el mensaje con el código en la tabla de notificaciones consultable por el portal', async () => {
    const { service, smsAdapter } = await build();
    await issueAndDeliver(service, { contactMethod, channel: 'sms' });
    // Se despacha por el adaptador directamente, no vía el orquestador que escribe en la tabla.
    expect(smsAdapter.send).toHaveBeenCalledTimes(1);
  });

  it('informa el fallo del proveedor sin lanzar: el intento igual debe quedar registrado', async () => {
    const { service, smsAdapter } = await build();
    (smsAdapter.send as jest.Mock).mockResolvedValueOnce({
      status: 'failed',
      provider: 'twilio_sms',
      errorCode: 'TWILIO_SMS_SEND_FAILED',
    } as never);

    const result = await issueAndDeliver(service, { contactMethod, channel: 'sms' });
    expect(result).toEqual({ delivered: false, provider: 'twilio_sms', errorCode: 'TWILIO_SMS_SEND_FAILED' });
  });

  it('degrada sin lanzar cuando el contacto cifrado no se puede leer', async () => {
    const { service } = await build();
    const result = await issueAndDeliver(service, {
      contactMethod: { id: 'c', contactValueEncrypted: null } as never,
      channel: 'sms',
    });
    expect(result).toEqual({ delivered: false, provider: 'none', errorCode: 'CONTACT_VALUE_UNREADABLE' });
  });

  describe('verify', () => {
    it('devuelve not_found cuando no hay un código vigente', async () => {
      const { service } = await build();
      await expect(service.verify({ customerId: 'c1', contactType: 'phone', candidate: '123456' })).resolves.toEqual({
        ok: false,
        reason: 'not_found',
      });
    });

    it('consume el código vencido para que ni el valor correcto sirva después', async () => {
      const { service, authRepository } = await build();
      const expired = { codeHash: 'x'.repeat(64), expiresAt: new Date(Date.now() - 1000) };
      (authRepository.findActiveOneTimeCodeByActor as jest.Mock).mockResolvedValueOnce(expired as never);

      await expect(service.verify({ customerId: 'c1', contactType: 'phone', candidate: '123456' })).resolves.toEqual({
        ok: false,
        reason: 'expired',
      });
      expect(authRepository.consumeOneTimeCode).toHaveBeenCalledWith(expired);
    });

    it('registra el intento fallido ante un código incorrecto, sin consumirlo', async () => {
      const { service, authRepository } = await build();
      const record = { codeHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000) };
      (authRepository.findActiveOneTimeCodeByActor as jest.Mock).mockResolvedValueOnce(record as never);

      await expect(service.verify({ customerId: 'c1', contactType: 'phone', candidate: '000000' })).resolves.toEqual({
        ok: false,
        reason: 'invalid',
      });
      expect(authRepository.registerOneTimeCodeFailedAttempt).toHaveBeenCalledWith(record, expect.any(Number));
      expect(authRepository.consumeOneTimeCode).not.toHaveBeenCalled();
    });

    it('consume el código al primer uso correcto', async () => {
      const { service, authRepository } = await build();
      const { hashOneTimeCode } = await import('../../../src/common/utils/crypto/one-time-code.util.js');
      const record = { codeHash: hashOneTimeCode('654321'), expiresAt: new Date(Date.now() + 60_000) };
      (authRepository.findActiveOneTimeCodeByActor as jest.Mock).mockResolvedValueOnce(record as never);

      await expect(service.verify({ customerId: 'c1', contactType: 'phone', candidate: '654321' })).resolves.toEqual({ ok: true });
      expect(authRepository.consumeOneTimeCode).toHaveBeenCalledWith(record);
    });
  });
});
