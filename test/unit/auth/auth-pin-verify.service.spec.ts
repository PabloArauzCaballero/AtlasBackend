import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthPinVerifyService } from '../../../src/modules/auth/auth-pin-verify.service.js';
import { hashPassword } from '../../../src/common/utils/crypto/password.util.js';

/**
 * Volver a pedir el PIN antes de enseñar datos personales.
 *
 * Responde SÓLO si el PIN es el de la cuenta de la sesión; no abre sesión, no manda correo y no toca el
 * contador de bloqueo del login (quien llega aquí ya tiene sesión: bloquear sería un botón de
 * denegación de servicio contra el dueño). Cada intento deja rastro.
 */
const REQUESTER = { actorType: 'customer' as const, actorId: '42', tenantId: '1', ip: '10.0.0.1', userAgent: 'jest' };

describe('AuthPinVerifyService', () => {
  let actorResolver: { reResolveActorWithEmail: jest.Mock };
  let repository: { findCredential: jest.Mock; recordEvent: jest.Mock };
  let service: AuthPinVerifyService;

  beforeEach(async () => {
    const passwordHash = await hashPassword('4821');
    actorResolver = { reResolveActorWithEmail: jest.fn(async () => ({ id: '42', tenantId: '1', email: 'a@b.c' })) };
    repository = {
      findCredential: jest.fn(async () => ({ passwordHash })),
      recordEvent: jest.fn(async () => undefined),
    };
    service = new AuthPinVerifyService(actorResolver as never, repository as never);
  });

  it('con el PIN correcto confirma y deja el intento exitoso en la bitácora', async () => {
    const resultado = await service.verify({ ...REQUESTER, pin: '4821' });

    expect(resultado.verified).toBe(true);
    expect(Number.isNaN(Date.parse(resultado.verifiedAt))).toBe(false);
    expect(repository.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'pin_verify', successful: true, failureReasonCode: null, actorType: 'customer', actorId: '42' }),
    );
  });

  it('con un PIN incorrecto responde 400 PIN_INCORRECT (no 401) y lo deja registrado como fallo', async () => {
    const error = await service.verify({ ...REQUESTER, pin: '0000' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'PIN_INCORRECT' });
    expect(repository.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'pin_verify', successful: false, failureReasonCode: 'invalid_pin' }),
    );
  });

  it('una cuenta que ya no existe es 401: ahí sí la sesión no sirve', async () => {
    actorResolver.reResolveActorWithEmail.mockResolvedValueOnce(null as never);

    await expect(service.verify({ ...REQUESTER, pin: '4821' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.recordEvent).not.toHaveBeenCalled();
  });

  it('una cuenta sin credencial es 401', async () => {
    repository.findCredential.mockResolvedValueOnce(null as never);

    await expect(service.verify({ ...REQUESTER, pin: '4821' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('la identidad viene del token: el servicio resuelve al actor que se le da, no a otro', async () => {
    await service.verify({ ...REQUESTER, pin: '4821' });

    expect(actorResolver.reResolveActorWithEmail).toHaveBeenCalledWith('customer', '42', '1');
    expect(repository.findCredential).toHaveBeenCalledWith('customer', '42');
  });
});
