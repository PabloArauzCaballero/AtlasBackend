import { describe, expect, it, jest } from '@jest/globals';
import { MailSenderService } from '../../../src/modules/mail-sender/mail-sender.service.js';

/**
 * `MailSenderService` es la fachada de dominio sobre `MailSenderClient`: traduce los tres correos
 * transaccionales de ATLAS a la plantilla + variables que el client entiende. Spec directo con el
 * client mockeado: verifica plantilla, sourceModule, variables y el nombre por defecto.
 */
describe('MailSenderService', () => {
  function build() {
    const client = { isConfigured: jest.fn(() => true), sendTemplateEmail: jest.fn(async () => ({ trackingId: 'tk1' })) };
    const service = new MailSenderService(client as never);
    return { service, client };
  }

  it('isEnabled delega en client.isConfigured', () => {
    const { service, client } = build();
    expect(service.isEnabled()).toBe(true);
    (client.isConfigured as jest.Mock).mockReturnValueOnce(false);
    expect(service.isEnabled()).toBe(false);
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
