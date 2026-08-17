import { describe, expect, it, jest } from '@jest/globals';
import { MailSenderService } from '../../../src/modules/mail-sender/mail-sender.service.js';

/**
 * `MailSenderService` es la fachada de dominio del correo transaccional: traduce los correos de
 * ATLAS a la plantilla + variables que entiende el transporte, y elige transporte. Spec directo con
 * ambos mockeados: verifica plantilla, sourceModule, variables, el nombre por defecto y —lo que
 * decide si existe el segundo factor— cuándo se considera que hay canal.
 */
describe('MailSenderService', () => {
  function build(options: { mailSender?: boolean; gmail?: boolean; webhook?: boolean } = {}) {
    const client = {
      isConfigured: jest.fn((..._args: unknown[]) => options.mailSender ?? true),
      sendTemplateEmail: jest.fn(async (..._args: unknown[]) => ({ trackingId: 'tk1' })),
    };
    const gmail = {
      isConfigured: jest.fn((..._args: unknown[]) => options.gmail ?? false),
      sendTemplateEmail: jest.fn(async (..._args: unknown[]) => ({ trackingId: 'gmail-1' })),
    };
    const webhook = {
      isConfigured: jest.fn((..._args: unknown[]) => options.webhook ?? false),
      sendTemplateEmail: jest.fn(async (..._args: unknown[]) => ({ trackingId: 'webhook-1' })),
    };
    const service = new MailSenderService(client as never, gmail as never, webhook as never);
    return { service, client, gmail, webhook };
  }

  it('hay canal si lo hay en cualquiera de los tres transportes', () => {
    expect(build({ mailSender: true }).service.isEnabled()).toBe(true);
    expect(build({ mailSender: false, gmail: true }).service.isEnabled()).toBe(true);
    expect(build({ mailSender: false, webhook: true }).service.isEnabled()).toBe(true);
    expect(build({ mailSender: false }).service.isEnabled()).toBe(false);
  });

  /*
   * El webhook existe para PROBAR el segundo factor sin apagarlo: un recolector local recibe el
   * correo y la batería lee de ahí el PIN. Que sea el último de la lista es lo que impide que
   * desvíe los correos de un despliegue que sí tiene un proveedor de verdad.
   */
  it('el webhook sólo entra cuando no hay MailSender ni Gmail', async () => {
    const conGmail = build({ mailSender: false, gmail: true, webhook: true });
    await conGmail.service.sendLoginPin({ to: 'a@x.com', recipientName: null, pin: '1', ttlMinutes: 5, reference: 'r' });
    expect(conGmail.webhook.sendTemplateEmail).not.toHaveBeenCalled();

    const soloWebhook = build({ mailSender: false, gmail: false, webhook: true });
    const res = await soloWebhook.service.sendLoginPin({ to: 'a@x.com', recipientName: null, pin: '1', ttlMinutes: 5, reference: 'r' });
    expect(res).toEqual({ trackingId: 'webhook-1' });
  });

  it('MailSender manda cuando está configurado, y Gmail no se toca', async () => {
    const { service, client, gmail } = build({ mailSender: true, gmail: true });
    const res = await service.sendLoginPin({ to: 'a@x.com', recipientName: 'Ana', pin: '123456', ttlMinutes: 5, reference: 'r' });
    expect(res).toEqual({ trackingId: 'tk1' });
    expect(client.sendTemplateEmail).toHaveBeenCalledTimes(1);
    expect(gmail.sendTemplateEmail).not.toHaveBeenCalled();
  });

  /*
   * El caso que motivó el segundo transporte: sin MailSender, el PIN del segundo factor no tenía por
   * dónde salir y `isRequired` degradaba el login interno a un solo factor, en silencio.
   */
  it('sin MailSender, el PIN sale por Gmail con la misma plantilla', async () => {
    const { service, client, gmail } = build({ mailSender: false, gmail: true });
    const res = await service.sendLoginPin({ to: 'a@x.com', recipientName: 'Ana', pin: '123456', ttlMinutes: 5, reference: 'r' });
    expect(res).toEqual({ trackingId: 'gmail-1' });
    expect(client.sendTemplateEmail).not.toHaveBeenCalled();
    expect(gmail.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'atlas-login-pin',
        to: 'a@x.com',
        variables: { nombre: 'Ana', pin: '123456', minutos: '5' },
      }),
    );
  });

  it('sendPasswordResetCode arma la plantilla de reset con nombre/código/minutos', async () => {
    const { service, client } = build();
    const res = await service.sendPasswordResetCode({ to: 'a@x.com', recipientName: 'Ana', code: '123', ttlMinutes: 10, reference: 'ref' });
    expect(res).toEqual({ trackingId: 'tk1' });
    expect(client.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'atlas-password-reset',
        to: 'a@x.com',
        sourceModule: 'auth',
        reference: 'ref',
        variables: { nombre: 'Ana', codigo: '123', minutos: '10' },
      }),
    );
  });

  it('usa el nombre por defecto "Usuario ATLAS" cuando recipientName es null', async () => {
    const { service, client } = build();
    await service.sendLoginPin({ to: 'a@x.com', recipientName: null, pin: '999', ttlMinutes: 5, reference: 'r' });
    expect(client.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'atlas-login-pin', variables: { nombre: 'Usuario ATLAS', pin: '999', minutos: '5' } }),
    );
  });

  it('sendInitialCredentials incluye email y contraseña temporal en las variables', async () => {
    const { service, client } = build();
    await service.sendInitialCredentials({ to: 'new@x.com', recipientName: 'Neo', temporaryPassword: 'Temp123!', reference: 'r' });
    expect(client.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'atlas-credenciales-iniciales',
        sourceModule: 'internal-users',
        variables: { nombre: 'Neo', email: 'new@x.com', password: 'Temp123!' },
      }),
    );
  });
});
