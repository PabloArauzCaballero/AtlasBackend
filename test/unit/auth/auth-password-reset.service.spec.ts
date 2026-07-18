import { describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { hashOneTimeCode } from '../../../src/common/utils/crypto/one-time-code.util.js';
import { AuthPasswordResetService } from '../../../src/modules/auth/auth-password-reset.service.js';

/**
 * `AuthPasswordResetService` es el flujo de dos pasos "olvidé mi contraseña" extraído de `AuthService`
 * (Fase 2.2). Comparte la resolución de actor (anti-enumeración) con el login. Este spec directo
 * ejercita las ramas de fallo genérico (sin enumeración), el fail-closed de correo y el camino feliz.
 */
describe('AuthPasswordResetService', () => {
  const actorWithEmail = { id: 'a1', tenantId: 't1', role: 'customer' as const, email: 'ana@mail.com', displayName: 'Ana' };

  function build() {
    const authRepository = {
      findCredentialsByActor: jest.fn(async () => ({ id: 'cred1' })),
      createOneTimeCode: jest.fn(async () => ({})),
      recordLoginAttemptEvent: jest.fn(async () => ({})),
      findActiveOneTimeCodeByActor: jest.fn(async () => null),
      registerOneTimeCodeFailedAttempt: jest.fn(async () => ({})),
      consumeOneTimeCode: jest.fn(async () => ({})),
      updatePasswordHash: jest.fn(async () => ({})),
      revokeAllRefreshTokensForActor: jest.fn(async () => 0),
    };
    const tokenRevocationService = { bumpTokenVersion: jest.fn(async () => undefined) };
    const mailSenderService = { isEnabled: jest.fn(() => true), sendPasswordResetCode: jest.fn(async () => undefined) };
    const actorResolver = { resolveActorForLogin: jest.fn(async () => null) };
    const service = new AuthPasswordResetService(
      authRepository as never,
      tokenRevocationService as never,
      mailSenderService as never,
      actorResolver as never,
    );
    return { service, authRepository, tokenRevocationService, mailSenderService, actorResolver };
  }

  const baseInput = { tenantId: 't1', actorType: 'customer' as const, identifier: 'ana@mail.com', ip: '1.1.1.1', userAgent: 'jest' };

  // --- requestPasswordReset --------------------------------------------------------------------

  it('requestPasswordReset falla (503) si el servicio de correo no está configurado', async () => {
    const { service, mailSenderService } = build();
    (mailSenderService.isEnabled as jest.Mock).mockReturnValueOnce(false);
    await expect(service.requestPasswordReset(baseInput)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('requestPasswordReset responde genérico y no crea código cuando el actor no existe', async () => {
    const { service, authRepository } = build();
    const res = await service.requestPasswordReset(baseInput);
    expect(res).toEqual({ requested: true });
    expect(authRepository.createOneTimeCode).not.toHaveBeenCalled();
  });

  it('requestPasswordReset responde genérico cuando el actor no tiene email', async () => {
    const { service, authRepository, actorResolver } = build();
    (actorResolver.resolveActorForLogin as jest.Mock).mockResolvedValueOnce({ ...actorWithEmail, email: null } as never);
    const res = await service.requestPasswordReset(baseInput);
    expect(res).toEqual({ requested: true });
    expect(authRepository.createOneTimeCode).not.toHaveBeenCalled();
  });

  it('requestPasswordReset responde genérico si el actor no tiene credenciales', async () => {
    const { service, authRepository, mailSenderService, actorResolver } = build();
    (actorResolver.resolveActorForLogin as jest.Mock).mockResolvedValueOnce(actorWithEmail as never);
    (authRepository.findCredentialsByActor as jest.Mock).mockResolvedValueOnce(null as never);
    const res = await service.requestPasswordReset(baseInput);
    expect(res).toEqual({ requested: true });
    expect(authRepository.createOneTimeCode).not.toHaveBeenCalled();
    expect(mailSenderService.sendPasswordResetCode).not.toHaveBeenCalled();
  });

  it('requestPasswordReset (feliz) crea el código, envía el correo y registra el evento', async () => {
    const { service, authRepository, mailSenderService, actorResolver } = build();
    (actorResolver.resolveActorForLogin as jest.Mock).mockResolvedValueOnce(actorWithEmail as never);
    const res = await service.requestPasswordReset(baseInput);
    expect(res).toEqual({ requested: true });
    expect(authRepository.createOneTimeCode).toHaveBeenCalledTimes(1);
    const [codeArgs] = (authRepository.createOneTimeCode as jest.Mock).mock.calls[0] as [Record<string, unknown>];
    expect(codeArgs).toMatchObject({ actorId: 'a1', purpose: 'password_reset' });
    const [mailArgs] = (mailSenderService.sendPasswordResetCode as jest.Mock).mock.calls[0] as [Record<string, unknown>];
    expect(mailArgs).toMatchObject({ to: 'ana@mail.com', recipientName: 'Ana' });
    expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledTimes(1);
  });

  // --- confirmPasswordReset --------------------------------------------------------------------

  const confirmInput = { ...baseInput, code: '123456', newPassword: 'NewPassw0rd!' };

  it('confirmPasswordReset rechaza una contraseña débil', async () => {
    const { service, actorResolver } = build();
    await expect(service.confirmPasswordReset({ ...confirmInput, newPassword: 'abc' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(actorResolver.resolveActorForLogin).not.toHaveBeenCalled();
  });

  it('confirmPasswordReset da error genérico si el actor no existe', async () => {
    const { service } = build();
    await expect(service.confirmPasswordReset(confirmInput)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('confirmPasswordReset da error genérico si no hay código activo o está expirado', async () => {
    const { service, authRepository, actorResolver } = build();
    (actorResolver.resolveActorForLogin as jest.Mock).mockResolvedValue(actorWithEmail as never);
    // sin código
    await expect(service.confirmPasswordReset(confirmInput)).rejects.toBeInstanceOf(UnauthorizedException);
    // código expirado
    (authRepository.findActiveOneTimeCodeByActor as jest.Mock).mockResolvedValueOnce({
      expiresAt: new Date(Date.now() - 1000),
      codeHash: hashOneTimeCode('123456'),
    } as never);
    await expect(service.confirmPasswordReset(confirmInput)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('confirmPasswordReset registra intento fallido y falla si el código no coincide', async () => {
    const { service, authRepository, actorResolver } = build();
    (actorResolver.resolveActorForLogin as jest.Mock).mockResolvedValueOnce(actorWithEmail as never);
    (authRepository.findActiveOneTimeCodeByActor as jest.Mock).mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 600_000),
      codeHash: hashOneTimeCode('999999'),
    } as never);
    await expect(service.confirmPasswordReset(confirmInput)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authRepository.registerOneTimeCodeFailedAttempt).toHaveBeenCalledTimes(1);
    expect(authRepository.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('confirmPasswordReset (feliz) consume el código, cambia el hash, revoca sesiones y sube tokenVersion', async () => {
    const { service, authRepository, tokenRevocationService, actorResolver } = build();
    (actorResolver.resolveActorForLogin as jest.Mock).mockResolvedValueOnce(actorWithEmail as never);
    (authRepository.findActiveOneTimeCodeByActor as jest.Mock).mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 600_000),
      codeHash: hashOneTimeCode('123456'),
    } as never);
    const res = await service.confirmPasswordReset(confirmInput);
    expect(res).toEqual({ passwordChanged: true });
    expect(authRepository.consumeOneTimeCode).toHaveBeenCalledTimes(1);
    expect(authRepository.updatePasswordHash).toHaveBeenCalledTimes(1);
    expect(authRepository.revokeAllRefreshTokensForActor).toHaveBeenCalledWith('customer', 'a1', 'password_reset');
    expect(tokenRevocationService.bumpTokenVersion).toHaveBeenCalledWith('customer', 'a1');
    expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledTimes(1);
  });
});
