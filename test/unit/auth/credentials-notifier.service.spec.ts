import { describe, expect, it, jest } from '@jest/globals';
import { CredentialsNotifierService } from '../../../src/modules/auth/credentials-notifier.service.js';

describe('CredentialsNotifierService', () => {
  const aviso = { to: 'nueva@empresa.com', recipientName: 'Nueva', temporaryPassword: 'Tmp#2026abc', reference: 'internal-user:77' };

  it('delega en el correo transaccional con el mismo aviso', async () => {
    const mail = { sendInitialCredentials: jest.fn(async (..._args: unknown[]) => ({ trackingId: 't' })) };
    await new CredentialsNotifierService(mail as never).sendInitialCredentials(aviso);
    expect(mail.sendInitialCredentials).toHaveBeenCalledWith(aviso);
  });

  it('si el correo falla NO lanza: el alta ya está escrita y la contraseña sigue en pantalla', async () => {
    const mail = {
      sendInitialCredentials: jest.fn(async (..._args: unknown[]) => {
        throw new Error('gmail caído');
      }),
    };
    await expect(new CredentialsNotifierService(mail as never).sendInitialCredentials(aviso)).resolves.toBeUndefined();
  });
});
