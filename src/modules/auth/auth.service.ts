/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { Injectable, UnauthorizedException, ForbiddenException, ConflictException, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { MetricsService } from '../../common/observability/metrics.service.js';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../config/env.js';
import { AtlasUserRole } from '../../common/types/auth.types.js';
import { hashPassword, isPasswordStrongEnough, verifyPassword } from '../../common/utils/crypto/password.util.js';
import { hashRefreshToken } from '../../common/utils/crypto/refresh-token.util.js';
import { TokenRevocationService } from '../../common/services/token-revocation.service.js';
import { MailSenderService } from '../mail-sender/mail-sender.service.js';
import { AuthActorResolverService } from './auth-actor-resolver.service.js';
import { AuthPasswordResetService } from './auth-password-reset.service.js';
import { AuthSecondFactorService } from './auth-second-factor.service.js';
import { AuthTokenIssuerService } from './auth-token-issuer.service.js';
import { ActorType, AuthRepository } from './auth.repository.js';
import {
  LoginPinChallengeResponseDto,
  LoginResponseDto,
  LogoutResponseDto,
  PasswordResetConfirmedResponseDto,
  PasswordResetRequestedResponseDto,
  ProvisionCredentialsResponseDto,
} from './auth.dtos.js';
import { LoginDto, ProvisionCredentialsDto } from './auth.schemas.js';

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
    private readonly actorResolver: AuthActorResolverService,
    private readonly passwordReset: AuthPasswordResetService,
    private readonly secondFactor: AuthSecondFactorService,
    private readonly tokenIssuer: AuthTokenIssuerService,
    private readonly tokenRevocationService: TokenRevocationService,
    private readonly mailSenderService: MailSenderService,
    @InjectConnection() private readonly sequelize: Sequelize,
    // `@Optional()` y ÚLTIMO a propósito: los specs lo construyen posicionalmente.
    @Optional() private readonly metrics?: MetricsService,
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
      await logAttempt({ actorId: null, reasonCode: 'actor_not_found' });
      throw invalidCredentialsError;
    }

    const credential = await this.authRepository.findCredentialsByActor(input.dto.actorType, actor.id);
    if (!credential) {
      await logAttempt({ actorId: actor.id, reasonCode: 'no_credentials' });
      throw invalidCredentialsError;
    }

    if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) {
      await logAttempt({ actorId: actor.id, reasonCode: 'account_locked' });
      throw new UnauthorizedException('Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta nuevamente más tarde.');
    }

    const passwordMatches = await verifyPassword(credential.passwordHash, input.dto.password);
    if (!passwordMatches) {
      await this.authRepository.recordFailedAttempt(credential, {
        maxAttempts: env.AUTH_MAX_FAILED_LOGIN_ATTEMPTS,
        lockoutMinutes: env.AUTH_LOCKOUT_MINUTES,
      });
      await logAttempt({ actorId: actor.id, reasonCode: 'invalid_password' });
      throw invalidCredentialsError;
    }

    if (this.secondFactor.isRequired(input.dto.actorType, credential)) {
      return this.secondFactor.issueChallenge(actor, input.dto.actorType, { ip: input.ip, userAgent: input.userAgent });
    }

    // Llega aquí sin segundo factor. En producción eso solo es legítimo para un `customer` sin MFA
    // opt-in: para un actor interno significa que el canal del PIN se cayó, y entonces no se emiten
    // tokens (ATLAS-SEC-008).
    this.secondFactor.assertDeliverable(input.dto.actorType);

    await this.authRepository.recordSuccessfulLogin(credential, input.ip);
    await logAttempt(null);

    return this.tokenIssuer.issueTokenPair(actor, input.dto.actorType, credential.tokenVersion, {
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  /**
   * MFA opt-in del cliente. Delegado en `AuthSecondFactorService` (ver ese archivo para la política
   * completa del segundo factor).
   */
  setCustomerMfaPreference(input: { actorId: string; enabled: boolean }): Promise<{ mfaEnabled: boolean }> {
    return this.secondFactor.setCustomerMfaPreference(input);
  }

  /**
   * Completa el login con segundo factor: token de desafío (paso 1, contraseña) + PIN del correo.
   *
   * La verificación vive en `AuthSecondFactorService`; aquí queda solo lo que es competencia de este
   * servicio — decidir qué claims lleva el par de tokens que se emite.
   */
  async verifyLoginPin(input: { challengeToken: string; pin: string; ip: string | null; userAgent: string | null }): Promise<LoginResult> {
    const verified = await this.secondFactor.consumeChallenge(input);
    return this.tokenIssuer.issueTokenPair(verified.actor, verified.actorType, verified.credential.tokenVersion, {
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  /** "Olvidé mi contraseña" (paso 1). Delegado en `AuthPasswordResetService`. */
  async requestPasswordReset(input: {
    tenantId: string;
    actorType: ActorType;
    identifier: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<PasswordResetRequestedResponseDto> {
    return this.passwordReset.requestPasswordReset(input);
  }

  /** Reset de contraseña (paso 2). Delegado en `AuthPasswordResetService`. */
  async confirmPasswordReset(input: {
    tenantId: string;
    actorType: ActorType;
    identifier: string;
    code: string;
    newPassword: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<PasswordResetConfirmedResponseDto> {
    return this.passwordReset.confirmPasswordReset(input);
  }

  /**
   * ATLAS-P0-AUTH-001: la rotación entera (leer, validar, revocar el viejo, crear el nuevo) corre
   * dentro de una única transacción con el token bloqueado por `FOR UPDATE`
   * (`AuthRepository.findRefreshTokenForUpdate`). Dos refresh concurrentes con el mismo token ya
   * no pueden leer ambos "todavía activo" y rotar dos veces: el segundo espera a que el primero
   * haga commit, y al releer ve el token ya revocado — cae en la rama de reuso.
   *
   * La transacción SIEMPRE resuelve (nunca lanza) y retorna un resultado discriminado; las
   * excepciones se lanzan recién afuera, después del commit. Esto es deliberado: si lanzáramos
   * dentro del callback de `sequelize.transaction`, Sequelize haría rollback automático — y en el
   * caso de reuso detectado, la revocación de la cadena de descendientes es justo lo que NO
   * queremos perder aunque la solicitud en sí termine en 401.
   */
  async refresh(input: { refreshToken: string; ip: string | null; userAgent: string | null }): Promise<LoginResult> {
    const tokenHash = hashRefreshToken(input.refreshToken);

    const outcome = await this.sequelize.transaction((transaction) =>
      this.rotateRefreshTokenWithinTransaction(tokenHash, input, transaction),
    );

    if (outcome.kind === 'success') {
      return {
        accessToken: outcome.accessToken,
        refreshToken: outcome.refreshToken,
        tokenType: 'Bearer',
        expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN,
      };
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

  private async rotateRefreshTokenWithinTransaction(
    tokenHash: string,
    input: { ip: string | null; userAgent: string | null },
    transaction: Transaction,
  ): Promise<
    | { kind: 'success'; accessToken: string; refreshToken: string }
    | { kind: 'invalid' }
    | { kind: 'actor_unavailable' }
    | { kind: 'reused'; actorType: ActorType; actorId: string }
  > {
    const stored = await this.authRepository.findRefreshTokenForUpdate(tokenHash, transaction);
    if (!stored) return { kind: 'invalid' };

    const actorType = stored.actorType as ActorType;

    if (stored.revokedAt) {
      // El token ya fue consumido antes. Si fue consumido específicamente por una rotación
      // (no por logout), que se vuelva a presentar es indicio de robo/reuso: alguien más tiene
      // una copia de un token que ya avanzó. Se corta toda la cadena de descendientes todavía
      // activos — no solo este token — porque el atacante pudo haber seguido rotando.
      if (stored.revokedReason === 'rotated') {
        const revokedDescendantIds = await this.authRepository.revokeDescendantChain(stored.id, transaction);
        await this.authRepository.recordRefreshReuseEvent(
          { tenantId: stored.tenantId, actorType, actorId: stored.actorId, reusedTokenId: stored.id, revokedDescendantIds },
          transaction,
        );
        return { kind: 'reused', actorType, actorId: stored.actorId };
      }
      return { kind: 'invalid' };
    }

    if (stored.expiresAt.getTime() < Date.now()) return { kind: 'invalid' };

    const credential = await this.authRepository.findCredentialsByActor(actorType, stored.actorId, { transaction });
    if (!credential) return { kind: 'invalid' };

    // El rol/tenant vigentes se re-resuelven antes de emitir un refresh token nuevo.
    const refreshedActor = await this.actorResolver.reResolveActorRole(actorType, stored.actorId, stored.tenantId);
    if (!refreshedActor) return { kind: 'actor_unavailable' };

    // Rotación: el refresh token usado queda revocado y se emite uno nuevo, en la misma
    // transacción y con la fila todavía bloqueada. `replacedByTokenId` queda registrado para
    // poder reconstruir la cadena de rotación completa en una investigación de robo de tokens.
    const newRefreshToken = await this.tokenIssuer.issueRefreshToken(
      {
        tenantId: refreshedActor.tenantId,
        actorType,
        actorId: refreshedActor.id,
        userAgent: input.userAgent,
        ipAddress: input.ip,
      },
      { transaction },
    );
    await this.authRepository.revokeRefreshToken(stored, 'rotated', newRefreshToken.id, { transaction });

    const accessToken = this.tokenIssuer.issueAccessToken(refreshedActor, actorType, credential.tokenVersion);
    return { kind: 'success', accessToken, refreshToken: newRefreshToken.token };
  }

  async logout(input: { refreshToken: string; allDevices: boolean }): Promise<LogoutResponseDto> {
    const tokenHash = hashRefreshToken(input.refreshToken);
    const stored = await this.authRepository.findActiveRefreshTokenByHash(tokenHash);
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
      await this.authRepository.revokeAllRefreshTokensForActor(stored.actorType as ActorType, stored.actorId, 'logout_all_devices');
      const credential = await this.authRepository.findCredentialsByActor(stored.actorType as ActorType, stored.actorId);
      if (credential) {
        // `TokenRevocationService` actualiza base de datos y caché para invalidar access tokens.
        await this.tokenRevocationService.bumpTokenVersion(credential.actorType, credential.actorId);
      }
    } else {
      await this.authRepository.revokeRefreshToken(stored, 'logout');
    }

    return { loggedOut: true };
  }

  /**
   * Provisión de credenciales para actores internos (`internal_user`/`platform_user`).
   * No existe autoregistro público para estos roles a propósito: permitir que cualquiera cree
   * una cuenta con rol `admin`/`platform_admin` sería una vulnerabilidad crítica. El flujo
   * correcto es: un `platform_admin` crea la fila en `internal_users`/`platform_users` y luego
   * usa este endpoint para fijar su contraseña inicial.
   *
   * ATLAS-SEC-007 — contención por tenant. Este endpoint fija la contraseña de una cuenta que el
   * solicitante NO controla, así que es el único punto del backend donde un actor puede fabricarse
   * un acceso ajeno. `TenantGuard` no lo cubre: el destino llega en `actorId` (cuerpo), no en
   * `x-tenant-id`. Sin este chequeo, un `admin` del tenant A provisionaba a un usuario interno del
   * tenant B sin credenciales y entraba como él con `x-tenant-id: B` — toma de cuenta entre
   * tenants, verificada en vivo (docs/audit/evidence/live-exploit-2026-08-06.md).
   *
   * Reglas:
   *  - `platform_admin` opera a nivel plataforma (su token no lleva `tenantId`): puede provisionar
   *    en cualquier tenant, y es el único que puede provisionar un `platform_user`.
   *  - `admin` es un rol DE TENANT: solo puede provisionar `internal_user` de su propio tenant.
   */
  async provisionCredentials(
    dto: ProvisionCredentialsDto,
    requestedBy: { role: AtlasUserRole; tenantId: string | null },
  ): Promise<ProvisionCredentialsResponseDto> {
    if (requestedBy.role !== 'admin' && requestedBy.role !== 'platform_admin') {
      throw new ForbiddenException('Solo un administrador puede provisionar credenciales.');
    }

    if (!isPasswordStrongEnough(dto.password)) {
      throw new UnauthorizedException('La contraseña no cumple el mínimo de seguridad requerido.');
    }

    const isPlatformAdmin = requestedBy.role === 'platform_admin';

    // Un `platform_user` no pertenece a ningún tenant: darle credenciales es un acto de alcance
    // plataforma y no puede autorizarlo un administrador de tenant.
    if (dto.actorType === 'platform_user' && !isPlatformAdmin) {
      throw new ForbiddenException('Solo un platform_admin puede provisionar credenciales de un usuario de plataforma.');
    }

    const actor =
      dto.actorType === 'internal_user'
        ? await this.authRepository.findInternalUserById(dto.actorId)
        : await this.authRepository.findPlatformUserById(dto.actorId);

    if (!actor) {
      throw new UnauthorizedException('El actor indicado no existe.');
    }

    const tenantId = 'tenantId' in actor ? (actor as { tenantId: string | null }).tenantId : null;

    // El mismo `ForbiddenException` para "otro tenant" y para "mi token no trae tenant": distinguir
    // ambos casos le confirmaría a un atacante que el `actorId` que probó SÍ existe en otro tenant.
    if (!isPlatformAdmin && (requestedBy.tenantId === null || tenantId !== requestedBy.tenantId)) {
      throw new ForbiddenException('No es posible provisionar credenciales de un actor de otro tenant.');
    }

    const existing = await this.authRepository.findCredentialsByActor(dto.actorType, dto.actorId);
    if (existing) {
      throw new ConflictException('CREDENTIALS_ALREADY_PROVISIONED');
    }

    const passwordHash = await hashPassword(dto.password);
    await this.authRepository.createCredentials({
      tenantId,
      actorType: dto.actorType,
      actorId: dto.actorId,
      passwordHash,
    });

    return { provisioned: true };
  }
}
