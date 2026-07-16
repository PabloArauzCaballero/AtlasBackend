import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { env } from '../../config/env.js';
import { hashPassword, isPasswordStrongEnough } from '../../common/utils/crypto/password.util.js';
import { generateNumericCode, hashOneTimeCode, verifyOneTimeCode } from '../../common/utils/crypto/one-time-code.util.js';
import { TokenRevocationService } from '../../common/services/token-revocation.service.js';
import { MailSenderService } from '../mail-sender/mail-sender.service.js';
import { AuthActorResolverService } from './auth-actor-resolver.service.js';
import { ActorType, AuthRepository } from './auth.repository.js';

/**
 * Flujo de "olvidé mi contraseña" en dos pasos (solicitud de código por correo + confirmación con
 * contraseña nueva), extraído de `AuthService` (Fase 2.2 del plan 10/10). Comparte la resolución de
 * actor con `AuthService` a través de `AuthActorResolverService`, así que ambos ven exactamente la
 * misma lógica anti-enumeración de cuentas.
 */
@Injectable()
export class AuthPasswordResetService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly tokenRevocationService: TokenRevocationService,
    private readonly mailSenderService: MailSenderService,
    private readonly actorResolver: AuthActorResolverService,
  ) {}

  /**
   * "Olvidé mi contraseña": envía un código de un solo uso al email del actor. La respuesta es
   * idéntica exista o no la cuenta (sin enumeración); solo falla si el servicio de correo no
   * está configurado, porque en ese caso NINGUNA solicitud podría completarse y ocultarlo solo
   * confundiría al operador.
   */
  async requestPasswordReset(input: {
    tenantId: string;
    actorType: ActorType;
    identifier: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{ requested: boolean }> {
    if (!this.mailSenderService.isEnabled()) {
      throw new ServiceUnavailableException('El servicio de correo no está configurado; no es posible enviar códigos de recuperación.');
    }

    const genericResponse = { requested: true };
    const actor = await this.actorResolver.resolveActorForLogin(input.tenantId, input.actorType, input.identifier);
    if (!actor || !actor.email) return genericResponse;

    const credential = await this.authRepository.findCredentialsByActor(input.actorType, actor.id);
    if (!credential) return genericResponse;

    const code = generateNumericCode();
    const ttlMinutes = env.AUTH_ONE_TIME_CODE_TTL_MINUTES;
    await this.authRepository.createOneTimeCode({
      tenantId: actor.tenantId,
      actorType: input.actorType,
      actorId: actor.id,
      purpose: 'password_reset',
      codeHash: hashOneTimeCode(code),
      challengeHash: null,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });

    await this.mailSenderService.sendPasswordResetCode({
      to: actor.email,
      recipientName: actor.displayName,
      code,
      ttlMinutes,
      reference: `password-reset-${input.actorType}-${actor.id}`,
    });

    await this.authRepository.recordLoginAttemptEvent({
      tenantId: actor.tenantId,
      actorType: input.actorType,
      actorId: actor.id,
      eventType: 'password_reset_request',
      successful: true,
      failureReasonCode: null,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    });

    return genericResponse;
  }

  /** Segundo paso del reset: código recibido por correo + contraseña nueva. */
  async confirmPasswordReset(input: {
    tenantId: string;
    actorType: ActorType;
    identifier: string;
    code: string;
    newPassword: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{ passwordChanged: boolean }> {
    // Mensaje genérico en todos los caminos de falla (actor inexistente, sin código activo,
    // código incorrecto/expirado) por la misma razón anti-enumeración que en `login`.
    const invalidCodeError = new UnauthorizedException('Código inválido o expirado.');

    if (!isPasswordStrongEnough(input.newPassword)) {
      throw new UnauthorizedException('La contraseña no cumple el mínimo de seguridad requerido.');
    }

    const actor = await this.actorResolver.resolveActorForLogin(input.tenantId, input.actorType, input.identifier);
    if (!actor) throw invalidCodeError;

    const oneTimeCode = await this.authRepository.findActiveOneTimeCodeByActor(input.actorType, actor.id, 'password_reset');
    if (!oneTimeCode || oneTimeCode.expiresAt.getTime() < Date.now()) throw invalidCodeError;

    if (!verifyOneTimeCode(input.code, oneTimeCode.codeHash)) {
      await this.authRepository.registerOneTimeCodeFailedAttempt(oneTimeCode, env.AUTH_ONE_TIME_CODE_MAX_ATTEMPTS);
      throw invalidCodeError;
    }

    const credential = await this.authRepository.findCredentialsByActor(input.actorType, actor.id);
    if (!credential) throw invalidCodeError;

    await this.authRepository.consumeOneTimeCode(oneTimeCode);
    await this.authRepository.updatePasswordHash(credential, await hashPassword(input.newPassword));

    // Cambio de contraseña = cerrar toda sesión previa: refresh tokens revocados y tokenVersion
    // incrementado vía TokenRevocationService (misma razón que logout allDevices: la caché Redis
    // de JwtAuthGuard debe invalidarse de inmediato, no al vencer su TTL).
    await this.authRepository.revokeAllRefreshTokensForActor(input.actorType, actor.id, 'password_reset');
    await this.tokenRevocationService.bumpTokenVersion(input.actorType, actor.id);

    await this.authRepository.recordLoginAttemptEvent({
      tenantId: actor.tenantId,
      actorType: input.actorType,
      actorId: actor.id,
      eventType: 'password_reset',
      successful: true,
      failureReasonCode: null,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    });

    return { passwordChanged: true };
  }
}
