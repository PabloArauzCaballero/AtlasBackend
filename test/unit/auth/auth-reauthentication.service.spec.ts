import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { hashOneTimeCode } from '../../../src/common/utils/crypto/one-time-code.util.js';
import { hashPassword } from '../../../src/common/utils/crypto/password.util.js';
import {
  AuthReauthenticationService,
  REAUTH_REQUIRED_CODE,
  REAUTH_TTL_SECONDS,
} from '../../../src/modules/auth/auth-reauthentication.service.js';

/**
 * ERP-03 — la reautenticación del comercio antes de cambiar su cuenta de cobro.
 *
 * Lo que vigila: que la prueba sólo salga con la contraseña correcta, que cada intento errado
 * cuente en el MISMO bloqueo que el login, y que la prueba sea de un solo uso, de vida corta y del
 * actor que la pidió. Cualquiera de esas cuatro que se afloje convierte una sesión robada otra vez
 * en un desvío de fondos.
 */
describe('AuthReauthenticationService', () => {
  const CLAVE = 'Contrasena#Comercio1';
  let passwordHash: string;

  beforeAll(async () => {
    // Hash real: se ejercita `verifyPassword` de verdad, no un doble que siempre dice que sí.
    passwordHash = await hashPassword(CLAVE);
  });

  const requester = { actorType: 'merchant_user' as const, actorId: '55', tenantId: '1', ip: '1.1.1.1', userAgent: 'jest' };

  function build(credentialOverrides: Record<string, unknown> = {}) {
    const credential = { id: 'cred-1', passwordHash, lockedUntil: null as Date | null, ...credentialOverrides };
    const authRepository = {
      findCredentialsByActor: jest.fn(async (..._args: unknown[]) => credential as unknown),
      reserveLoginAttempt: jest.fn(async (..._args: unknown[]) => null as unknown),
      clearFailedAttempts: jest.fn(async (..._args: unknown[]) => undefined),
      recordLoginAttemptEvent: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const oneTimeCodeRepository = {
      createOneTimeCode: jest.fn(async (..._args: unknown[]) => ({})),
      findActiveOneTimeCodeByChallenge: jest.fn(async (..._args: unknown[]) => null as unknown),
      consumeOneTimeCode: jest.fn(async (..._args: unknown[]) => true),
    };
    const actorResolver = {
      reResolveActorRole: jest.fn(async (..._args: unknown[]) => ({ id: '55', tenantId: '1', role: 'merchant' }) as unknown),
    };
    const service = new AuthReauthenticationService(authRepository as never, oneTimeCodeRepository as never, actorResolver as never);
    return { service, authRepository, oneTimeCodeRepository, actorResolver };
  }

  function proof(overrides: Record<string, unknown> = {}) {
    return {
      id: 'otc-1',
      purpose: 'sensitive_reauth',
      actorType: 'merchant_user',
      actorId: '55',
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    };
  }

  describe('emitir la prueba', () => {
    it('con la contraseña correcta emite un token opaco de 5 minutos, guarda SÓLO su huella y desbloquea el contador', async () => {
      const { service, authRepository, oneTimeCodeRepository } = build();

      const result = await service.issue({ ...requester, password: CLAVE });

      expect(result.expiresInSeconds).toBe(REAUTH_TTL_SECONDS);
      expect(REAUTH_TTL_SECONDS).toBe(300);
      expect(result.reauthToken.length).toBeGreaterThanOrEqual(48);
      const [guardado] = oneTimeCodeRepository.createOneTimeCode.mock.calls[0] as [Record<string, unknown>];
      expect(guardado).toMatchObject({
        actorType: 'merchant_user',
        actorId: '55',
        purpose: 'sensitive_reauth',
        challengeHash: hashOneTimeCode(result.reauthToken),
      });
      expect(JSON.stringify(guardado)).not.toContain(result.reauthToken);
      expect((guardado.expiresAt as Date).getTime()).toBeLessThanOrEqual(Date.now() + REAUTH_TTL_SECONDS * 1000);
      expect(authRepository.clearFailedAttempts).toHaveBeenCalledWith('cred-1');
      expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'sensitive_reauth', successful: true, actorId: '55' }),
      );
    });

    it('una contraseña errada responde 400 (no 401: la sesión es buena), cuenta en el bloqueo del login y no emite nada', async () => {
      const { service, authRepository, oneTimeCodeRepository } = build();

      const error = await service.issue({ ...requester, password: 'otra-cosa' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'REAUTH_INVALID_PASSWORD' });
      expect(authRepository.reserveLoginAttempt).toHaveBeenCalledWith(
        'cred-1',
        expect.objectContaining({ maxAttempts: expect.any(Number) }),
      );
      expect(authRepository.clearFailedAttempts).not.toHaveBeenCalled();
      expect(oneTimeCodeRepository.createOneTimeCode).not.toHaveBeenCalled();
      expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'sensitive_reauth', successful: false, failureReasonCode: 'invalid_password' }),
      );
    });

    it('con la cuenta ya bloqueada responde 429 ACCOUNT_LOCKED con la hora, sin comparar la contraseña', async () => {
      const hasta = new Date(Date.now() + 10 * 60_000);
      const { service, authRepository } = build({ lockedUntil: hasta });

      const error = await service.issue({ ...requester, password: CLAVE }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({ code: 'ACCOUNT_LOCKED', lockedUntil: hasta.toISOString() });
      expect(authRepository.reserveLoginAttempt).not.toHaveBeenCalled();
    });

    it('si ESTE intento agota el cupo, también 429 y no se emite la prueba', async () => {
      const { service, authRepository, oneTimeCodeRepository } = build();
      authRepository.reserveLoginAttempt.mockResolvedValueOnce({ lockedUntil: null } as never);

      const error = await service.issue({ ...requester, password: CLAVE }).catch((e: unknown) => e);

      expect((error as HttpException).getStatus()).toBe(429);
      expect(oneTimeCodeRepository.createOneTimeCode).not.toHaveBeenCalled();
    });

    it('una identidad que ya no está activa no obtiene prueba', async () => {
      const { service, actorResolver } = build();
      actorResolver.reResolveActorRole.mockResolvedValueOnce(null as never);

      await expect(service.issue({ ...requester, password: CLAVE })).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('exigir la prueba', () => {
    const exigir = { actorType: 'merchant_user' as const, actorId: '55', reauthToken: 'token-de-prueba' };

    async function codigo(promesa: Promise<unknown>) {
      const error = await promesa.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      return ((error as ForbiddenException).getResponse() as { code: string }).code;
    }

    it('sin cabecera responde 403 REAUTH_REQUIRED sin tocar la base', async () => {
      const { service, oneTimeCodeRepository } = build();

      expect(await codigo(service.assertValid({ ...exigir, reauthToken: undefined }))).toBe(REAUTH_REQUIRED_CODE);
      expect(await codigo(service.consume({ ...exigir, reauthToken: '   ' }))).toBe(REAUTH_REQUIRED_CODE);
      expect(oneTimeCodeRepository.findActiveOneTimeCodeByChallenge).not.toHaveBeenCalled();
    });

    it.each([
      ['inexistente o ya usada', null],
      ['vencida', proof({ expiresAt: new Date(Date.now() - 1) })],
      ['de OTRO usuario', proof({ actorId: '56' })],
      ['de otro propósito (el PIN del login no sirve)', proof({ purpose: 'login_pin' })],
    ])('una prueba %s responde 403 REAUTH_REQUIRED', async (_caso, fila) => {
      const { service, oneTimeCodeRepository } = build();
      oneTimeCodeRepository.findActiveOneTimeCodeByChallenge.mockResolvedValue(fila as never);

      expect(await codigo(service.consume(exigir))).toBe(REAUTH_REQUIRED_CODE);
      expect(oneTimeCodeRepository.consumeOneTimeCode).not.toHaveBeenCalled();
    });

    it('comprobar no la gasta; consumir sí, buscándola por su huella', async () => {
      const { service, oneTimeCodeRepository } = build();
      oneTimeCodeRepository.findActiveOneTimeCodeByChallenge.mockResolvedValue(proof() as never);

      await service.assertValid(exigir);
      expect(oneTimeCodeRepository.consumeOneTimeCode).not.toHaveBeenCalled();

      await service.consume(exigir);
      expect(oneTimeCodeRepository.findActiveOneTimeCodeByChallenge).toHaveBeenCalledWith(hashOneTimeCode('token-de-prueba'));
      expect(oneTimeCodeRepository.consumeOneTimeCode).toHaveBeenCalledTimes(1);
    });

    it('dos usos concurrentes: el que pierde la carrera recibe REAUTH_REQUIRED', async () => {
      const { service, oneTimeCodeRepository } = build();
      oneTimeCodeRepository.findActiveOneTimeCodeByChallenge.mockResolvedValue(proof() as never);
      oneTimeCodeRepository.consumeOneTimeCode.mockResolvedValueOnce(false as never);

      expect(await codigo(service.consume(exigir))).toBe(REAUTH_REQUIRED_CODE);
    });
  });
});
