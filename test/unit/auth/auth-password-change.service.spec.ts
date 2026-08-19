import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { hashOneTimeCode } from '../../../src/common/utils/crypto/one-time-code.util.js';
import { hashPassword } from '../../../src/common/utils/crypto/password.util.js';
import { AuthPasswordChangeService } from '../../../src/modules/auth/auth-password-change.service.js';

/**
 * `AuthPasswordChangeService` es el cambio de contraseña de un actor YA autenticado: contraseña
 * actual + código de un solo uso al correo registrado, en dos pasos.
 *
 * Lo que este spec vigila no es el camino feliz —que también—, sino las cuatro formas de convertir
 * el endpoint en una escalada: cambiar sin segundo factor, cambiar la contraseña de otro con un
 * desafío ajeno, reutilizar el desafío del login para escribir una contraseña, y "cambiarla" por la
 * misma que ya era.
 */
describe('AuthPasswordChangeService', () => {
  const ACTUAL = 'Contrasena#Actual1';
  let passwordHash: string;

  beforeAll(async () => {
    // Hash real (argon2): así se ejercita `verifyPassword` de verdad y no un doble que siempre dice
    // que sí, que es justo la comprobación que sostiene el primer paso.
    passwordHash = await hashPassword(ACTUAL);
  });

  const actor = { id: 'u1', tenantId: 't1', role: 'admin' as const, email: 'ada@atlas.mx', displayName: 'Ada' };
  const requester = { actorType: 'internal_user' as const, actorId: 'u1', tenantId: 't1', ip: '1.1.1.1', userAgent: 'jest' };

  function build() {
    const oneTimeCodeRepository = {
      findActiveOneTimeCodeByActor: jest.fn(async (..._args: unknown[]) => null as unknown),
      findActiveOneTimeCodeByChallenge: jest.fn(async (..._args: unknown[]) => null as unknown),
      createOneTimeCode: jest.fn(async (..._args: unknown[]) => ({})),
      registerOneTimeCodeFailedAttempt: jest.fn(async (..._args: unknown[]) => undefined),
      consumeOneTimeCode: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const passwordChangeRepository = {
      findCredential: jest.fn(async (..._args: unknown[]) => ({ passwordHash }) as unknown),
      applyNewPassword: jest.fn(async (..._args: unknown[]) => undefined),
      recordEvent: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const tokenRevocationService = { bumpTokenVersion: jest.fn(async (..._args: unknown[]) => undefined) };
    const mailSenderService = {
      isEnabled: jest.fn((..._args: unknown[]) => true),
      sendPasswordChangeCode: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const actorResolver = { reResolveActorWithEmail: jest.fn(async (..._args: unknown[]) => actor as unknown) };
    const service = new AuthPasswordChangeService(
      oneTimeCodeRepository as never,
      passwordChangeRepository as never,
      tokenRevocationService as never,
      mailSenderService as never,
      actorResolver as never,
    );
    return { service, oneTimeCodeRepository, passwordChangeRepository, tokenRevocationService, mailSenderService, actorResolver };
  }

  /** Un desafío vigente de cambio de contraseña, del propio solicitante. */
  function challenge(overrides: Record<string, unknown> = {}) {
    return {
      actorType: 'internal_user',
      actorId: 'u1',
      purpose: 'password_change',
      tenantId: 't1',
      codeHash: hashOneTimeCode('123456'),
      expiresAt: new Date(Date.now() + 600_000),
      ...overrides,
    };
  }

  // --- paso 1: solicitud -----------------------------------------------------------------------

  it('responde 503 y no cambia nada si no hay canal de correo — sin la degradación a un factor del login', async () => {
    const { service, mailSenderService, oneTimeCodeRepository } = build();
    mailSenderService.isEnabled.mockReturnValueOnce(false);

    await expect(service.requestPasswordChange({ ...requester, currentPassword: ACTUAL })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(oneTimeCodeRepository.createOneTimeCode).not.toHaveBeenCalled();
  });

  it('rechaza la contraseña actual incorrecta sin gastar un correo, y deja el intento en la bitácora', async () => {
    const { service, mailSenderService, oneTimeCodeRepository, passwordChangeRepository } = build();

    await expect(service.requestPasswordChange({ ...requester, currentPassword: 'la-que-no-es' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mailSenderService.sendPasswordChangeCode).not.toHaveBeenCalled();
    expect(oneTimeCodeRepository.createOneTimeCode).not.toHaveBeenCalled();
    expect(passwordChangeRepository.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'password_change_request', successful: false, failureReasonCode: 'invalid_current_password' }),
    );
  });

  it('no reenvía el código si ya se emitió uno hace menos de un minuto', async () => {
    const { service, oneTimeCodeRepository, mailSenderService } = build();
    oneTimeCodeRepository.findActiveOneTimeCodeByActor.mockResolvedValueOnce({ createdAtValue: new Date(Date.now() - 5_000) });

    await expect(service.requestPasswordChange({ ...requester, currentPassword: ACTUAL })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mailSenderService.sendPasswordChangeCode).not.toHaveBeenCalled();
  });

  it('emite el código con propósito password_change y devuelve el desafío', async () => {
    const { service, oneTimeCodeRepository, mailSenderService } = build();

    const result = await service.requestPasswordChange({ ...requester, currentPassword: ACTUAL });

    expect(result.pinChallengeRequired).toBe(true);
    expect(result.challengeToken.length).toBeGreaterThan(20);
    expect(oneTimeCodeRepository.createOneTimeCode).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'password_change', actorType: 'internal_user', actorId: 'u1' }),
    );
    expect(mailSenderService.sendPasswordChangeCode).toHaveBeenCalledWith(expect.objectContaining({ to: 'ada@atlas.mx' }));
  });

  // --- paso 2: confirmación --------------------------------------------------------------------

  const confirmInput = { ...requester, challengeToken: 'x'.repeat(32), code: '123456', newPassword: 'NuevaClave#2026' };

  it('rechaza una contraseña nueva que no cumple el mínimo de seguridad', async () => {
    const { service, passwordChangeRepository } = build();

    await expect(service.confirmPasswordChange({ ...confirmInput, newPassword: 'corta' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(passwordChangeRepository.applyNewPassword).not.toHaveBeenCalled();
  });

  it('rechaza un desafío que pertenece a OTRO actor — el token opaco por sí solo no basta', async () => {
    const { service, oneTimeCodeRepository, passwordChangeRepository } = build();
    oneTimeCodeRepository.findActiveOneTimeCodeByChallenge.mockResolvedValueOnce(challenge({ actorId: 'otro' }));

    await expect(service.confirmPasswordChange(confirmInput)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(passwordChangeRepository.applyNewPassword).not.toHaveBeenCalled();
  });

  it('rechaza el desafío del PIN de login: un propósito no sirve para el otro', async () => {
    const { service, oneTimeCodeRepository, passwordChangeRepository } = build();
    oneTimeCodeRepository.findActiveOneTimeCodeByChallenge.mockResolvedValueOnce(challenge({ purpose: 'login_pin' }));

    await expect(service.confirmPasswordChange(confirmInput)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(passwordChangeRepository.applyNewPassword).not.toHaveBeenCalled();
  });

  it('rechaza un desafío expirado', async () => {
    const { service, oneTimeCodeRepository } = build();
    oneTimeCodeRepository.findActiveOneTimeCodeByChallenge.mockResolvedValueOnce(challenge({ expiresAt: new Date(Date.now() - 1_000) }));

    await expect(service.confirmPasswordChange(confirmInput)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('cuenta el intento fallido cuando el código no coincide', async () => {
    const { service, oneTimeCodeRepository, passwordChangeRepository } = build();
    oneTimeCodeRepository.findActiveOneTimeCodeByChallenge.mockResolvedValueOnce(challenge());

    await expect(service.confirmPasswordChange({ ...confirmInput, code: '999999' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(oneTimeCodeRepository.registerOneTimeCodeFailedAttempt).toHaveBeenCalled();
    expect(passwordChangeRepository.applyNewPassword).not.toHaveBeenCalled();
  });

  it('rechaza repetir la contraseña que ya se tenía, y no consume el desafío por ello', async () => {
    const { service, oneTimeCodeRepository, passwordChangeRepository } = build();
    oneTimeCodeRepository.findActiveOneTimeCodeByChallenge.mockResolvedValueOnce(challenge());

    await expect(service.confirmPasswordChange({ ...confirmInput, newPassword: ACTUAL })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(passwordChangeRepository.applyNewPassword).not.toHaveBeenCalled();
    expect(oneTimeCodeRepository.consumeOneTimeCode).not.toHaveBeenCalled();
  });

  it('aplica la contraseña, consume el desafío, revoca toda sesión y registra el evento', async () => {
    const { service, oneTimeCodeRepository, passwordChangeRepository, tokenRevocationService } = build();
    oneTimeCodeRepository.findActiveOneTimeCodeByChallenge.mockResolvedValueOnce(challenge());

    await expect(service.confirmPasswordChange(confirmInput)).resolves.toEqual({ passwordChanged: true });

    expect(oneTimeCodeRepository.consumeOneTimeCode).toHaveBeenCalled();
    expect(passwordChangeRepository.applyNewPassword).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'internal_user', actorId: 'u1' }),
    );
    expect(tokenRevocationService.bumpTokenVersion).toHaveBeenCalledWith('internal_user', 'u1');
    expect(passwordChangeRepository.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'password_change', successful: true }),
    );
  });

  it('rechaza a quien perdió la cuenta entre la solicitud y la confirmación', async () => {
    const { service, oneTimeCodeRepository, actorResolver, passwordChangeRepository } = build();
    oneTimeCodeRepository.findActiveOneTimeCodeByChallenge.mockResolvedValueOnce(challenge());
    actorResolver.reResolveActorWithEmail.mockResolvedValueOnce(null);

    await expect(service.confirmPasswordChange(confirmInput)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(passwordChangeRepository.applyNewPassword).not.toHaveBeenCalled();
  });
});
