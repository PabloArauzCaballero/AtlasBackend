import { describe, expect, it, jest } from '@jest/globals';
import { resolveOtpFallbackEmail } from '../../../src/modules/customer-onboarding/application/otp-fallback-email.util.js';

/*
 * Quién puede recibir un código de teléfono por correo. Es una decisión con consecuencias: el
 * código llega a un contacto del MISMO cliente, pero quien lo escribe demuestra que tiene ese
 * correo, no ese número. Por eso cada «no» de aquí abajo es deliberado.
 */
jest.mock('../../../src/common/utils/crypto/envelope-encryption.util.js', () => ({
  decryptSecretEnvelope: jest.fn(async (sobre: string) => {
    if (sobre === 'roto') throw new Error('sobre ilegible');
    return sobre === 'vacio' ? '   ' : 'yo@atlas.bo';
  }),
}));

function repositorio(contacto: unknown) {
  return { findCustomerContactMethod: jest.fn(async () => contacto) } as never;
}
const base = { tenantId: '1', customerId: '42', contactType: 'phone', habilitada: true };

describe('Correo de reserva para el código del teléfono', () => {
  it('con la reserva encendida devuelve el correo del cliente', async () => {
    const repo = repositorio({ id: 9, contactValueEncrypted: 'sobre' });
    await expect(resolveOtpFallbackEmail(repo, base)).resolves.toBe('yo@atlas.bo');
  });

  it('apagada no busca siquiera: en producción un SMS que no sale es un incidente, no algo que rodear', async () => {
    const repo = repositorio({ id: 9, contactValueEncrypted: 'sobre' });
    await expect(resolveOtpFallbackEmail(repo, { ...base, habilitada: false })).resolves.toBeNull();
    expect((repo as unknown as { findCustomerContactMethod: jest.Mock }).findCustomerContactMethod).not.toHaveBeenCalled();
  });

  it('para el propio correo no hay reserva: repetir el canal que falló es repetir el fallo', async () => {
    const repo = repositorio({ id: 9, contactValueEncrypted: 'sobre' });
    await expect(resolveOtpFallbackEmail(repo, { ...base, contactType: 'email' })).resolves.toBeNull();
  });

  it('sin correo registrado no se inventa ninguno', async () => {
    await expect(resolveOtpFallbackEmail(repositorio(null), base)).resolves.toBeNull();
    await expect(resolveOtpFallbackEmail(repositorio({ id: 9, contactValueEncrypted: null }), base)).resolves.toBeNull();
  });

  it('un sobre ilegible degrada a «sin reserva», no tumba el envío', async () => {
    await expect(resolveOtpFallbackEmail(repositorio({ id: 9, contactValueEncrypted: 'roto' }), base)).resolves.toBeNull();
  });

  it('un correo en blanco no es una dirección', async () => {
    await expect(resolveOtpFallbackEmail(repositorio({ id: 9, contactValueEncrypted: 'vacio' }), base)).resolves.toBeNull();
  });
});
