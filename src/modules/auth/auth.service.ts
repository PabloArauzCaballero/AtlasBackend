/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */ import { TracingService } from '../../common/observability/tracing.service.js';

import { Injectable, UnauthorizedException, Optional } from '@nestjs/common';
import { MetricsService } from '../../common/observability/metrics.service.js';
import { env } from '../../config/env.js';

import { verifyPassword, verifyPasswordAgainstDummy } from '../../common/utils/crypto/password.util.js';
import { hashRefreshToken } from '../../common/utils/crypto/refresh-token.util.js';
import { TokenRevocationService } from '../../common/services/token-revocation.service.js';
import { AuthActorResolverService } from './auth-actor-resolver.service.js';
import { AuthRefreshRotationService } from './auth-refresh-rotation.service.js';
import { AuthRefreshTokensRepository } from './auth-refresh-tokens.repository.js';
import { AuthSecondFactorService } from './auth-second-factor.service.js';
import { AuthTokenIssuerService } from './auth-token-issuer.service.js';
import { SESSION_EXPIRED_CODE } from './customer-session-lifetime.js';
import { ActorType, AuthRepository } from './auth.repository.js';
import { LoginPinChallengeResponseDto, LoginResponseDto, LogoutResponseDto } from './auth.dtos.js';
import { LoginDto } from './auth.schemas.js';

type LoginResult = LoginResponseDto;

/**
 * Segundo paso del login de super admins: la contraseña ya fue validada, pero los tokens recién
 * se emiten cuando el PIN enviado por correo se presenta junto con este token de desafío.
 */
export type LoginPinChallenge = LoginPinChallengeResponseDto;

export type LoginOutcome = LoginResult | LoginPinChallenge;

export function isLoginPinChallenge(outcome: LoginOutcome): outcome is LoginPinChallenge {
  return 'pinChallengeRequired' in outcome;
}

/**
 * Emisor único de JWT de producción para clientes, usuarios internos y usuarios de plataforma.
 * La resolución de actor vive en `AuthActorResolverService` y el flujo de reset de contraseña en
 * `AuthPasswordResetService` (Fase 2.2 del plan 10/10); aquí queda la orquestación de login, PIN de
 * super admin, rotación de refresh token, logout y provisión de credenciales.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly refreshTokens: AuthRefreshTokensRepository,
    private readonly rotation: AuthRefreshRotationService,
    private readonly actorResolver: AuthActorResolverService,
    private readonly secondFactor: AuthSecondFactorService,
    private readonly tokenIssuer: AuthTokenIssuerService,
    private readonly tokenRevocationService: TokenRevocationService,
    // `@Optional()` y ÚLTIMO a propósito: los specs lo construyen posicionalmente.
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly tracing: TracingService = new TracingService(),
  ) {}

  async login(input: { tenantId: string; dto: LoginDto; ip: string | null; userAgent: string | null }): Promise<LoginOutcome> {
    const actor = await this.actorResolver.resolveActorForLogin(input.tenantId, input.dto.actorType, input.dto.identifier);

    // Mensaje deliberadamente genérico en los tres casos de falla (actor inexistente, sin
    // credenciales, contraseña incorrecta) para no facilitar enumeración de cuentas/usuarios
    // registrados a través de mensajes de error distintos.
    const invalidCredentialsError = new UnauthorizedException('Credenciales inválidas.');

    // La métrica va en el MISMO embudo que el evento de auditoría (hallazgo A-10): así ninguna rama
    // de fallo puede olvidarse de contarse, que es justo lo que pasaría instrumentando cada `throw`.
    const logAttempt = (failed: { actorId: string | null; reasonCode: string } | null) => {
      this.metrics?.recordAuthAttempt({ actorType: input.dto.actorType, outcome: failed?.reasonCode ?? 'success' });
      // Al MISMO embudo, y como atributos del span del request en vez de un span propio: un
      // `auth.authenticate` cubriría exactamente el mismo tramo que `POST /auth/login` y sería un
      // span redundante. Lo que falta en la traza no es el tramo, es POR QUÉ falló el login, y el
      // motivo pertenece a un catálogo cerrado (nunca el identificador que se intentó usar).
      this.tracing.setAttributes({ 'auth.actor.type': input.dto.actorType, 'auth.outcome': failed?.reasonCode ?? 'success' });
      return this.authRepository.recordLoginAttemptEvent({
        tenantId: input.tenantId,
        actorType: input.dto.actorType,
        actorId: failed ? failed.actorId : (actor?.id ?? null),
        eventType: 'login',
        successful: failed === null,
        failureReasonCode: failed?.reasonCode ?? null,
        ipAddress: input.ip,
        userAgent: input.userAgent,
      });
    };

    if (!actor) {
      await verifyPasswordAgainstDummy(input.dto.password);
      await logAttempt({ actorId: null, reasonCode: 'actor_not_found' });
      throw invalidCredentialsError;
    }

    const credential = await this.authRepository.findCredentialsByActor(input.dto.actorType, actor.id);
    if (!credential) {
      await verifyPasswordAgainstDummy(input.dto.password);
      await logAttempt({ actorId: actor.id, reasonCode: 'no_credentials' });
      throw invalidCredentialsError;
    }

    /*
     * El bloqueo dice HASTA CUÁNDO, no «más tarde».
     *
     * Antes se respondía con una frase suelta y sin código, así que la app no podía distinguir
     * «te equivocaste de contraseña» de «estás bloqueado» —caía en el mensaje genérico— y quien
     * lo leía no tenía forma de saber si esperar un minuto o una hora. La respuesta previsible
     * es no volver a intentarlo nunca, o intentarlo cada diez segundos: las dos peores.
     *
     * Decir cuándo se puede volver no debilita el control: el bloqueo sigue siendo el mismo
     * tiempo y quien lo provocó ya sabe que existe. Lo que cambia es que el titular legítimo
     * —que es quien casi siempre se equivoca de contraseña— sabe qué hacer con su tarde.
     */
    const rejectLocked = async (lockedUntil: Date | null): Promise<never> => {
      await logAttempt({ actorId: actor.id, reasonCode: 'account_locked' });
      const until = lockedUntil ?? new Date(Date.now() + env.AUTH_LOCKOUT_MINUTES * 60_000);
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message: 'Cuenta bloqueada temporalmente por múltiples intentos fallidos.',
        lockedUntil: until.toISOString(),
        retryAfterSeconds: Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)),
      });
    };

    if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) await rejectLocked(credential.lockedUntil);

    // El intento se RESERVA antes de argon2 y en un solo UPDATE: con la lectura de arriba sola, N
    // peticiones en paralelo veían «sin bloqueo», probaban N secretos y dejaban el contador en k+1.
    // Sobre un PIN de 4 dígitos eso era recorrer el espacio entero entre bloqueo y bloqueo.
    const locked = await this.authRepository.reserveLoginAttempt(credential.id, {
      maxAttempts: env.AUTH_MAX_FAILED_LOGIN_ATTEMPTS,
      lockoutMinutes: env.AUTH_LOCKOUT_MINUTES,
    });
    if (locked) await rejectLocked(locked.lockedUntil);

    const passwordMatches = await verifyPassword(credential.passwordHash, input.dto.password);
    if (!passwordMatches) {
      await logAttempt({ actorId: actor.id, reasonCode: 'invalid_password' });
      throw invalidCredentialsError;
    }
    await this.authRepository.clearFailedAttempts(credential.id);

    if (this.secondFactor.isRequired(input.dto.actorType, credential)) {
      return this.secondFactor.issueChallenge(actor, input.dto.actorType, { ip: input.ip, userAgent: input.userAgent });
    }

    // Sin segundo factor sólo es legítimo para quien la política no se lo exige (cliente o comercio
    // sin MFA). Para un interno, o para quien SÍ activó MFA, significa que el canal del PIN se cayó
    // y no se emiten tokens (ATLAS-SEC-008). La credencial distingue los dos casos.
    this.secondFactor.assertDeliverable(input.dto.actorType, credential);

    await this.authRepository.recordSuccessfulLogin(credential, input.ip);
    await logAttempt(null);

    return this.tokenIssuer.issueTokenPair(actor, input.dto.actorType, credential.tokenVersion, {
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  /**
   * Completa el login con segundo factor: token de desafío (paso 1, contraseña) + PIN del correo.
   *
   * La verificación vive en `AuthSecondFactorService`; aquí queda solo lo que es competencia de este
   * servicio — decidir qué claims lleva el par de tokens que se emite.
   */
  async verifyLoginPin(input: {
    challengeToken: string;
    pin: string;
    ip: string | null;
    userAgent: string | null;
    expectedActorType?: ActorType;
  }): Promise<LoginResult> {
    const verified = await this.secondFactor.consumeChallenge(input);
    return this.tokenIssuer.issueTokenPair(verified.actor, verified.actorType, verified.credential.tokenVersion, {
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  /** Rotación del refresh token (ver `AuthRefreshRotationService`); aquí se traduce el resultado a la respuesta HTTP. */
  async refresh(input: {
    refreshToken: string;
    ip: string | null;
    userAgent: string | null;
    expectedActorType?: ActorType;
  }): Promise<LoginResult> {
    const outcome = await this.rotation.rotate(input.refreshToken, input);

    if (outcome.kind === 'success') {
      return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken, tokenType: 'Bearer', expiresIn: outcome.expiresIn };
    }

    if (outcome.kind === 'session_expired') {
      // Distinto del 401 genérico a propósito: la app sabe que no es un token roto sino el tope de la sesión, y
      // puede pedir la contraseña o el PIN con ese mensaje. En modo cookie el controlador borra la cookie.
      throw new UnauthorizedException({
        code: SESSION_EXPIRED_CODE,
        message: 'La sesión superó su duración máxima. Vuelve a iniciar sesión.',
      });
    }

    if (outcome.kind === 'reused') {
      // Fuera de la transacción ya confirmada: mismo mecanismo que `logout(allDevices=true)`
      // (`TokenRevocationService.bumpTokenVersion`, no `AuthRepository`) para que la caché Redis
      // de `JwtAuthGuard` quede invalidada de inmediato, no recién al vencer su TTL.
      await this.tokenRevocationService.bumpTokenVersion(outcome.actorType, outcome.actorId);
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }

    if (outcome.kind === 'actor_unavailable') {
      throw new UnauthorizedException('El actor asociado a este token ya no está disponible.');
    }

    throw new UnauthorizedException('Refresh token inválido o expirado.');
  }

  async logout(input: { refreshToken: string; allDevices: boolean }): Promise<LogoutResponseDto> {
    const tokenHash = hashRefreshToken(input.refreshToken);
    const stored = await this.refreshTokens.findActiveRefreshTokenByHash(tokenHash);
    if (!stored) {
      // Idempotente: cerrar sesión con un token ya inválido/inexistente no es un error.
      return { loggedOut: true };
    }

    await this.authRepository.recordLoginAttemptEvent({
      tenantId: stored.tenantId,
      actorType: stored.actorType as ActorType,
      actorId: stored.actorId,
      eventType: 'logout',
      successful: true,
      failureReasonCode: null,
      ipAddress: null,
      userAgent: null,
    });

    if (input.allDevices) {
      await this.refreshTokens.revokeAllRefreshTokensForActor(stored.actorType as ActorType, stored.actorId, 'logout_all_devices');
      const credential = await this.authRepository.findCredentialsByActor(stored.actorType as ActorType, stored.actorId);
      if (credential) {
        // `TokenRevocationService` actualiza base de datos y caché para invalidar access tokens.
        await this.tokenRevocationService.bumpTokenVersion(credential.actorType, credential.actorId);
      }
    } else {
      await this.refreshTokens.revokeRefreshToken(stored, 'logout');
    }

    return { loggedOut: true };
  }
}
