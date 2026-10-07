import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthPinVerifyService, PIN_VERIFY_WINDOW_MS } from '../../../src/modules/auth/auth-pin-verify.service.js';
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
  let repository: { findCredential: jest.Mock; recordEvent: jest.Mock; countRecentPinFailures: jest.Mock };
  let service: AuthPinVerifyService;

  beforeEach(async () => {
    const passwordHash = await hashPassword('4821');
    actorResolver = { reResolveActorWithEmail: jest.fn(async () => ({ id: '42', tenantId: '1', email: 'a@b.c' })) };
    repository = {
      findCredential: jest.fn(async () => ({ passwordHash })),
      recordEvent: jest.fn(async () => undefined),
      countRecentPinFailures: jest.fn(async () => 0),
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

  it('con demasiados fallos recientes de ESA cuenta responde 429 sin mirar el PIN, ni siquiera el correcto', async () => {
    repository.countRecentPinFailures.mockResolvedValueOnce(5 as never);

    const error = await service.verify({ ...REQUESTER, pin: '4821' }).catch((caught: unknown) => caught);

    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'PIN_VERIFY_COOLDOWN' });
    // No suma otro fallo: la pausa tiene que poder terminar aunque la persona insista.
    expect(repository.recordEvent).not.toHaveBeenCalled();
  });

  it('cuenta los fallos de la cuenta de la sesión dentro de la ventana, no los de la IP', async () => {
    const antes = Date.now();
    await service.verify({ ...REQUESTER, pin: '4821' });

    const [actorId, since] = repository.countRecentPinFailures.mock.calls[0] as [string, Date];
    expect(actorId).toBe('42');
    expect(antes - since.getTime()).toBeGreaterThanOrEqual(PIN_VERIFY_WINDOW_MS - 1_000);
    expect(antes - since.getTime()).toBeLessThanOrEqual(PIN_VERIFY_WINDOW_MS + 1_000);
  });

  it('por debajo del tope sigue comprobando el PIN', async () => {
    repository.countRecentPinFailures.mockResolvedValueOnce(4 as never);
    await expect(service.verify({ ...REQUESTER, pin: '4821' })).resolves.toMatchObject({ verified: true });
  });

  it('una ráfaga simultánea no supera el tope: las que exceden reciben 429 sin mirar el PIN', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 8 }, () => service.verify({ ...REQUESTER, pin: '0000' }).catch((caught: unknown) => caught)),
    );

    const pausadas = resultados.filter((r) => r instanceof HttpException && r.getStatus() === 429);
    expect(pausadas).toHaveLength(3);
    expect(repository.recordEvent).toHaveBeenCalledTimes(5);
  });
});
