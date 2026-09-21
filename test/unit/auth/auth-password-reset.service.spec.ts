import { describe, expect, it, jest } from '@jest/globals';
import { Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
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
      findCredentialsByActor: jest.fn(async (..._args: unknown[]) => ({ id: 'cred1' })),
      createOneTimeCode: jest.fn(async (..._args: unknown[]) => ({})),
      recordLoginAttemptEvent: jest.fn(async (..._args: unknown[]) => ({})),
      findActiveOneTimeCodeByActor: jest.fn(async (..._args: unknown[]) => null),
      registerOneTimeCodeFailedAttempt: jest.fn(async (..._args: unknown[]) => ({})),
      consumeOneTimeCode: jest.fn(async (..._args: unknown[]) => ({})),
      updatePasswordHash: jest.fn(async (..._args: unknown[]) => ({})),
      revokeAllRefreshTokensForActor: jest.fn(async (..._args: unknown[]) => 0),
    };
    const tokenRevocationService = { bumpTokenVersion: jest.fn(async (..._args: unknown[]) => undefined) };
    const mailSenderService = {
      isEnabled: jest.fn((..._args: unknown[]) => true),
      sendPasswordResetCode: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const actorResolver = { resolveActorForLogin: jest.fn(async (..._args: unknown[]) => null) };
    const service = new AuthPasswordResetService(
      authRepository as never,
      // Mismo doble: los códigos de un solo uso viven ahora en su propio repositorio, pero el mock
      // ya expone esos métodos y las aserciones siguen mirando el mismo objeto.
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

  /**
   * Los cuatro caminos que no envían nada contestan lo mismo que un envío correcto —tiene que ser
   * así o la pantalla pública delata qué correos están registrados—, y hasta el 2026-09-21 no
   * dejaban ningún rastro: «el comercio no recibe el código» era indistinguible de «ese comercio no
   * existe en este entorno», que era la causa real en TEST. El motivo va al log del servidor, que
   * no lo ve quien pregunta, y nombra el DOMINIO y nunca el buzón, que es PII.
   */
  it('requestPasswordReset deja en el log por qué no envió nada, sin escribir el buzón', async () => {
    const avisos: string[] = [];
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(((mensaje: unknown) => {
      avisos.push(String(mensaje));
    }) as never);
    try {
      const sinActor = build();
      await sinActor.service.requestPasswordReset(baseInput);

      const sinCorreo = build();
      (sinCorreo.actorResolver.resolveActorForLogin as jest.Mock).mockResolvedValueOnce({ ...actorWithEmail, email: null } as never);
      await sinCorreo.service.requestPasswordReset(baseInput);

      const sinCredencial = build();
      (sinCredencial.actorResolver.resolveActorForLogin as jest.Mock).mockResolvedValueOnce(actorWithEmail as never);
      (sinCredencial.authRepository.findCredentialsByActor as jest.Mock).mockResolvedValueOnce(null as never);
      await sinCredencial.service.requestPasswordReset(baseInput);

      const enEnfriamiento = build();
      (enEnfriamiento.actorResolver.resolveActorForLogin as jest.Mock).mockResolvedValueOnce(actorWithEmail as never);
      (enEnfriamiento.authRepository.findActiveOneTimeCodeByActor as jest.Mock).mockResolvedValueOnce({
        createdAtValue: new Date(),
      } as never);
      await enEnfriamiento.service.requestPasswordReset(baseInput);
    } finally {
      warn.mockRestore();
    }

    expect(avisos).toHaveLength(4);
    expect(avisos[0]).toContain('no hay ningún actor activo');
    expect(avisos[1]).toContain('no tiene correo de contacto');
    expect(avisos[2]).toContain('no tiene credencial');
    expect(avisos[3]).toContain('hace menos de 60 s');
    for (const aviso of avisos) {
      expect(aviso).toContain("dominio 'mail.com'");
      expect(aviso).not.toContain('ana@');
    }
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

  /*
   * El CLIENTE restablece con un PIN de cuatro digitos, no con una contrasena larga: es la misma
   * regla con la que se dio de alta. Si el restablecimiento exigiera contrasena, la cuenta quedaria
   * con un secreto que su propio login no sabe pedir.
   */
  const confirmInput = { ...baseInput, code: '123456', newPassword: '5183' };

  it('confirmPasswordReset rechaza un PIN que no tiene cuatro digitos', async () => {
    const { service, actorResolver } = build();
    await expect(service.confirmPasswordReset({ ...confirmInput, newPassword: 'abc' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(actorResolver.resolveActorForLogin).not.toHaveBeenCalled();
  });

  it('confirmPasswordReset rechaza un PIN adivinable aunque tenga cuatro digitos', async () => {
    const { service, actorResolver } = build();
    await expect(service.confirmPasswordReset({ ...confirmInput, newPassword: '1234' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(actorResolver.resolveActorForLogin).not.toHaveBeenCalled();
  });

  it('confirmPasswordReset exige contrasena larga a un usuario interno, no un PIN', async () => {
    const { service, actorResolver } = build();
    const internal = { ...confirmInput, actorType: 'internal_user' as const };
    await expect(service.confirmPasswordReset({ ...internal, newPassword: '5183' })).rejects.toBeInstanceOf(UnauthorizedException);
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
