/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza impide que una cuenta de administración quede protegida solo por su contraseña.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { env } from '../../config/env.js';
import {
  generateChallengeToken,
  generateNumericCode,
  hashOneTimeCode,
  verifyOneTimeCode,
} from '../../common/utils/crypto/one-time-code.util.js';
import { MailSenderService } from '../mail-sender/mail-sender.service.js';
import { AuthActorResolverService, ResolvedActor } from './auth-actor-resolver.service.js';
import { ActorType, AuthRepository } from './auth.repository.js';
import { AuthOneTimeCodeRepository } from './auth-one-time-code.repository.js';
import { LoginPinChallengeResponseDto } from './auth.dtos.js';

type Network = { ip: string | null; userAgent: string | null };

/** Actor ya verificado por el segundo factor, listo para que `AuthService` emita su par de tokens. */
export type VerifiedSecondFactor = {
  actor: ResolvedActor;
  actorType: ActorType;
  credential: { tokenVersion: number };
};

/**
 * Política y mecánica del SEGUNDO FACTOR de login (PIN de un solo uso por correo).
 *
 * Extraído de `AuthService` en la auditoría integral del 2026-08-06, por el mismo criterio con el
 * que ya se habían extraído `AuthActorResolverService` y `AuthPasswordResetService`: es una
 * responsabilidad cohesiva —"¿hace falta un segundo factor, se puede entregar, y se presentó
 * correctamente?"— que cambia por razones propias (política de MFA, canal de entrega, TTL del
 * código) distintas de las del resto del login.
 *
 * Deja fuera a propósito la emisión de tokens: quien decide qué claims lleva un access token sigue
 * siendo `AuthService`, y este servicio se limita a devolver el actor verificado.
 */
@Injectable()
export class AuthSecondFactorService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly oneTimeCodeRepository: AuthOneTimeCodeRepository,
    private readonly actorResolver: AuthActorResolverService,
    private readonly mailSenderService: MailSenderService,
  ) {}

  /**
   * Decide si el login exige un segundo factor.
   *  - Actores INTERNOS (`internal_user`, `platform_user`): 2FA OBLIGATORIO, no solo super admins.
   *  - CLIENTES (`customer`): 2FA solo si activaron MFA opt-in (`credential.mfaEnabled`).
   *
   * Fuera de producción la falta de canal de correo degrada a un solo paso, para no dejar el backend
   * inaccesible en local; `AUTH_LOGIN_PIN_ENABLED=false` lo desactiva por completo (entornos de
   * test). En PRODUCCIÓN esa degradación no existe — ver `assertDeliverable`.
   */
  isRequired(actorType: ActorType, credential: { mfaEnabled?: boolean }): boolean {
    if (!env.AUTH_LOGIN_PIN_ENABLED || !this.mailSenderService.isEnabled()) return false;
    if (actorType !== 'customer') return true;
    return credential.mfaEnabled === true;
  }

  /**
   * ATLAS-SEC-008 — fail-closed del segundo factor interno en producción.
   *
   * `isRequired` devuelve `false` si MailSender no está disponible. Esa degradación, pensada para
   * desarrollo, convertía una caída del proveedor de correo en una **rebaja silenciosa de
   * autenticación**: `admin` y `platform_admin` entrando con solo la contraseña, con 200 y sin
   * rastro (verificado en vivo: docs/audit/evidence/live-exploit-2026-08-06.md).
   *
   * `env-cross-checks.ts` ya impide arrancar en producción sin canal de correo; esto cubre la
   * ventana que la configuración no puede cubrir: el proveedor configurado pero caído en el momento
   * del login. Se rechaza el acceso (503) en vez de emitir tokens de un solo factor. Denegar el
   * login de un operador es un incidente de disponibilidad; emitir esos tokens es uno de seguridad.
   */
  assertDeliverable(actorType: ActorType): void {
    if (env.NODE_ENV !== 'production' || actorType === 'customer') return;
    if (env.AUTH_LOGIN_PIN_ENABLED && this.mailSenderService.isEnabled()) return;

    throw new ServiceUnavailableException(
      'El segundo factor es obligatorio para actores internos y su canal de entrega no está disponible. ' +
        'No se emiten tokens de un solo factor.',
    );
  }

  /** MFA opt-in del cliente. Solo aplica a `customer` (los internos tienen 2FA obligatorio). */
  async setCustomerMfaPreference(input: { actorId: string; enabled: boolean }): Promise<{ mfaEnabled: boolean }> {
    const credential = await this.authRepository.findCredentialsByActor('customer', input.actorId);
    if (!credential) {
      throw new UnauthorizedException('No hay credenciales para este cliente.');
    }
    if (input.enabled && !this.mailSenderService.isEnabled()) {
      // Fail-closed a la inversa: no dejar activar MFA si no hay canal para entregar el OTP, para no
      // dejar al cliente bloqueado en el próximo login.
      throw new ServiceUnavailableException('No es posible activar MFA: el servicio de correo no está configurado.');
    }
    await this.authRepository.setMfaEnabled(credential, input.enabled);
    return { mfaEnabled: input.enabled };
  }

  /** Paso 1: la contraseña ya se validó; se emite y envía el PIN, y se devuelve el token de desafío. */
  async issueChallenge(actor: ResolvedActor, actorType: ActorType, network: Network): Promise<LoginPinChallengeResponseDto> {
    if (!actor.email) {
      // Solo alcanzable si un super admin no tiene email registrado — no debería existir, pero
      // fallar cerrado es lo correcto para un rol de administración total.
      throw new UnauthorizedException('La cuenta de administrador no tiene un email registrado para recibir el PIN.');
    }

    const pin = generateNumericCode();
    const challengeToken = generateChallengeToken();
    const ttlMinutes = env.AUTH_ONE_TIME_CODE_TTL_MINUTES;
    await this.oneTimeCodeRepository.createOneTimeCode({
      tenantId: actor.tenantId,
      actorType,
      actorId: actor.id,
      purpose: 'login_pin',
      codeHash: hashOneTimeCode(pin),
      challengeHash: hashOneTimeCode(challengeToken),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });

    await this.mailSenderService.sendLoginPin({
      to: actor.email,
      recipientName: actor.displayName,
      pin,
      ttlMinutes,
      reference: `login-pin-${actorType}-${actor.id}`,
    });

    await this.authRepository.recordLoginAttemptEvent({
      tenantId: actor.tenantId,
      actorType,
      actorId: actor.id,
      eventType: 'login_pin_challenge',
      successful: true,
      failureReasonCode: null,
      ipAddress: network.ip,
      userAgent: network.userAgent,
    });

    return { pinChallengeRequired: true, challengeToken, expiresInMinutes: ttlMinutes };
  }

  /**
   * Paso 2: canjea `challengeToken` + PIN. Devuelve el actor verificado; la emisión de tokens la
   * decide `AuthService`.
   *
   * El mismo mensaje para "desafío inexistente", "expirado" y "PIN incorrecto" es deliberado: son
   * tres estados que un atacante no debe poder distinguir.
   */
  async consumeChallenge(input: { challengeToken: string; pin: string } & Network): Promise<VerifiedSecondFactor> {
    const invalidPinError = new UnauthorizedException('PIN inválido o expirado.');

    const challenge = await this.oneTimeCodeRepository.findActiveOneTimeCodeByChallenge(hashOneTimeCode(input.challengeToken));
    if (!challenge || challenge.purpose !== 'login_pin' || challenge.expiresAt.getTime() < Date.now()) {
      throw invalidPinError;
    }

    const actorType = challenge.actorType as ActorType;
    if (!verifyOneTimeCode(input.pin, challenge.codeHash)) {
      await this.oneTimeCodeRepository.registerOneTimeCodeFailedAttempt(challenge, env.AUTH_ONE_TIME_CODE_MAX_ATTEMPTS);
      await this.authRepository.recordLoginAttemptEvent({
        tenantId: challenge.tenantId,
        actorType,
        actorId: challenge.actorId,
        eventType: 'login',
        successful: false,
        failureReasonCode: 'invalid_login_pin',
        ipAddress: input.ip,
        userAgent: input.userAgent,
      });
      throw invalidPinError;
    }

    await this.oneTimeCodeRepository.consumeOneTimeCode(challenge);

    const actor = await this.actorResolver.reResolveActorRole(actorType, challenge.actorId, challenge.tenantId);
    const credential = actor ? await this.authRepository.findCredentialsByActor(actorType, actor.id) : null;
    if (!actor || !credential) {
      throw new UnauthorizedException('El actor asociado a este PIN ya no está disponible.');
    }

    await this.authRepository.recordSuccessfulLogin(credential, input.ip);
    await this.authRepository.recordLoginAttemptEvent({
      tenantId: actor.tenantId,
      actorType,
      actorId: actor.id,
      eventType: 'login',
      successful: true,
      failureReasonCode: null,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    });

    return { actor, actorType, credential };
  }
}
