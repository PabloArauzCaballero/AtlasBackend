import { Injectable, UnauthorizedException, ForbiddenException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../config/env.js';
import { AtlasUserRole } from '../../common/types/auth.types.js';
import { hashPassword, isPasswordStrongEnough, verifyPassword } from '../../common/utils/crypto/password.util.js';
import { generateRefreshToken, hashRefreshToken } from '../../common/utils/crypto/refresh-token.util.js';
import {
  generateChallengeToken,
  generateNumericCode,
  hashOneTimeCode,
  verifyOneTimeCode,
} from '../../common/utils/crypto/one-time-code.util.js';
import { hashSensitiveText } from '../../common/utils/crypto/hash.util.js';
import { TokenRevocationService } from '../../common/services/token-revocation.service.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { MailSenderService } from '../mail-sender/mail-sender.service.js';
import { ActorType, AuthRepository } from './auth.repository.js';
import { LoginDto, ProvisionCredentialsDto } from './auth.schemas.js';

type ResolvedActor = {
  id: string;
  tenantId: string | null;
  role: AtlasUserRole;
  /** Email de contacto para correos transaccionales (para actores internos, el mismo email de login). */
  email: string | null;
  displayName: string | null;
};

type LoginResult = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
};

/**
 * Segundo paso del login de super admins: la contraseña ya fue validada, pero los tokens recién
 * se emiten cuando el PIN enviado por correo se presenta junto con este token de desafío.
 */
export type LoginPinChallenge = {
  pinChallengeRequired: true;
  challengeToken: string;
  expiresInMinutes: number;
};

export type LoginOutcome = LoginResult | LoginPinChallenge;

export function isLoginPinChallenge(outcome: LoginOutcome): outcome is LoginPinChallenge {
  return 'pinChallengeRequired' in outcome;
}

const KNOWN_ROLES: ReadonlySet<AtlasUserRole> = new Set([
  'customer',
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'system',
  'system_admin',
  'qa_engineer',
  'devops',
  'readonly_auditor',
  'merchant',
  'admin',
  'platform_admin',
]);

function isKnownRole(value: string): value is AtlasUserRole {
  return KNOWN_ROLES.has(value as AtlasUserRole);
}

// "Super admins": roles con administración total. Con MailSender configurado, su login exige un
// PIN adicional entregado por correo (ver `AuthService.login` / `verifyLoginPin`).
const LOGIN_PIN_REQUIRED_ROLES: ReadonlySet<AtlasUserRole> = new Set(['admin', 'platform_admin']);

/**
 * ATLAS-AUDIT-002 (cerrado en este patch): antes de `AuthModule`, el único emisor de JWT en
 * todo el proyecto era `scripts/create-dev-jwt.ts`, una herramienta de línea de comandos para
 * desarrolladores. Ningún cliente real (app móvil, portal comercio, panel de operaciones)
 * tenía forma de autenticarse. `AuthService` es ahora el único emisor de JWT de producción.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly tokenRevocationService: TokenRevocationService,
    private readonly mailSenderService: MailSenderService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  private async resolveActorForLogin(tenantId: string, actorType: ActorType, identifier: string): Promise<ResolvedActor | null> {
    if (actorType === 'customer') {
      const identifierHash = hashSensitiveText(identifier);
      const customer = await this.customersRepository.findByContactHash(tenantId, {
        phoneHash: identifierHash,
        emailHash: identifierHash,
      });
      if (!customer || customer.lifecycleStatus === 'closed') return null;
      // El email/teléfono del cliente se almacena hasheado; el único valor en claro disponible
      // es el identificador que el propio cliente acaba de escribir (y que coincidió por hash).
      const email = identifier.includes('@') ? identifier : null;
      return { id: customer.id, tenantId: customer.tenantId, role: 'customer', email, displayName: null };
    }

    if (actorType === 'internal_user') {
      // SUPUESTO_ATLAS: la búsqueda de email es case-sensitive tal como está almacenado. Si el
      // equipo confirma que los emails deben tratarse como case-insensitive, normalizar aquí y
      // al crear el registro en `internal_users` (fuera del alcance de este patch: esa tabla se
      // administra hoy solo por seed/migración manual, no por un módulo de gestión de usuarios).
      const internalUser = await this.authRepository.findInternalUserByEmail(identifier, tenantId);
      if (!internalUser || internalUser.status !== 'active' || !internalUser.roleCode || !isKnownRole(internalUser.roleCode)) {
        return null;
      }
      return {
        id: internalUser.id,
        tenantId: internalUser.tenantId,
        role: internalUser.roleCode,
        email: internalUser.email,
        displayName: internalUser.fullName,
      };
    }

    // platform_user
    const platformUser = await this.authRepository.findPlatformUserByEmail(identifier);
    if (!platformUser || platformUser.status !== 'active' || !platformUser.roleCode || !isKnownRole(platformUser.roleCode)) {
      return null;
    }
    return { id: platformUser.id, tenantId: null, role: platformUser.roleCode, email: platformUser.email, displayName: platformUser.fullName };
  }

  private issueAccessToken(actor: ResolvedActor, actorType: ActorType, tokenVersion: number): string {
    const payload: Record<string, unknown> = {
      sub: actor.id,
      role: actor.role,
      tokenVersion,
      ...(actor.tenantId ? { tenantId: actor.tenantId } : {}),
      ...(actorType === 'customer' ? { customerId: actor.id } : {}),
      ...(actorType === 'internal_user' ? { internalUserId: actor.id } : {}),
      ...(actorType === 'platform_user' ? { platformUserId: actor.id } : {}),
    };

    const options: SignOptions = {
      algorithm: 'HS256',
      expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN as SignOptions['expiresIn'],
    };

    return jwt.sign(payload, env.JWT_ACCESS_TOKEN_SECRET, options);
  }

  private async issueRefreshToken(
    input: {
      tenantId: string | null;
      actorType: ActorType;
      actorId: string;
      userAgent: string | null;
      ipAddress: string | null;
    },
    options: { transaction?: Transaction } = {},
  ): Promise<{ token: string; id: string }> {
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + env.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);
    const created = await this.authRepository.createRefreshToken(
      {
        tenantId: input.tenantId,
        actorType: input.actorType,
        actorId: input.actorId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
      },
      options,
    );
    return { token: refreshToken, id: created.id };
  }

  async login(input: { tenantId: string; dto: LoginDto; ip: string | null; userAgent: string | null }): Promise<LoginOutcome> {
    const actor = await this.resolveActorForLogin(input.tenantId, input.dto.actorType, input.dto.identifier);

    // Mensaje deliberadamente genérico en los tres casos de falla (actor inexistente, sin
    // credenciales, contraseña incorrecta) para no facilitar enumeración de cuentas/usuarios
    // registrados a través de mensajes de error distintos.
    const invalidCredentialsError = new UnauthorizedException('Credenciales inválidas.');

    const logAttempt = (failed: { actorId: string | null; reasonCode: string } | null) =>
      this.authRepository.recordLoginAttemptEvent({
        tenantId: input.tenantId,
        actorType: input.dto.actorType,
        actorId: failed ? failed.actorId : actor?.id ?? null,
        eventType: 'login',
        successful: failed === null,
        failureReasonCode: failed?.reasonCode ?? null,
        ipAddress: input.ip,
        userAgent: input.userAgent,
      });

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

    if (this.isLoginPinRequired(actor.role)) {
      return this.issueLoginPinChallenge(actor, input.dto.actorType, { ip: input.ip, userAgent: input.userAgent });
    }

    await this.authRepository.recordSuccessfulLogin(credential, input.ip);
    await logAttempt(null);

    return this.issueTokenPair(actor, input.dto.actorType, credential.tokenVersion, { ip: input.ip, userAgent: input.userAgent });
  }

  private async issueTokenPair(
    actor: ResolvedActor,
    actorType: ActorType,
    tokenVersion: number,
    network: { ip: string | null; userAgent: string | null },
  ): Promise<LoginResult> {
    const accessToken = this.issueAccessToken(actor, actorType, tokenVersion);
    const issuedRefreshToken = await this.issueRefreshToken({
      tenantId: actor.tenantId,
      actorType,
      actorId: actor.id,
      userAgent: network.userAgent,
      ipAddress: network.ip,
    });

    return { accessToken, refreshToken: issuedRefreshToken.token, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN };
  }

  /**
   * El PIN de super admin solo se exige cuando hay forma real de entregarlo: sin MailSender
   * configurado el login queda en un solo paso (comportamiento previo), nunca bloqueado.
   */
  private isLoginPinRequired(role: AtlasUserRole): boolean {
    return env.AUTH_LOGIN_PIN_ENABLED && LOGIN_PIN_REQUIRED_ROLES.has(role) && this.mailSenderService.isEnabled();
  }

  private async issueLoginPinChallenge(
    actor: ResolvedActor,
    actorType: ActorType,
    network: { ip: string | null; userAgent: string | null },
  ): Promise<LoginPinChallenge> {
    if (!actor.email) {
      // Solo alcanzable si un super admin no tiene email registrado — no debería existir, pero
      // fallar cerrado es lo correcto para un rol de administración total.
      throw new UnauthorizedException('La cuenta de administrador no tiene un email registrado para recibir el PIN.');
    }

    const pin = generateNumericCode();
    const challengeToken = generateChallengeToken();
    const ttlMinutes = env.AUTH_ONE_TIME_CODE_TTL_MINUTES;
    await this.authRepository.createOneTimeCode({
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

  /** Completa el login de un super admin: token de desafío (paso 1, contraseña) + PIN del correo. */
  async verifyLoginPin(input: { challengeToken: string; pin: string; ip: string | null; userAgent: string | null }): Promise<LoginResult> {
    const invalidPinError = new UnauthorizedException('PIN inválido o expirado.');

    const challenge = await this.authRepository.findActiveOneTimeCodeByChallenge(hashOneTimeCode(input.challengeToken));
    if (!challenge || challenge.purpose !== 'login_pin' || challenge.expiresAt.getTime() < Date.now()) {
      throw invalidPinError;
    }

    const actorType = challenge.actorType as ActorType;
    if (!verifyOneTimeCode(input.pin, challenge.codeHash)) {
      await this.authRepository.registerOneTimeCodeFailedAttempt(challenge, env.AUTH_ONE_TIME_CODE_MAX_ATTEMPTS);
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

    await this.authRepository.consumeOneTimeCode(challenge);

    const actor = await this.reResolveActorRole(actorType, challenge.actorId, challenge.tenantId);
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

    return this.issueTokenPair(actor, actorType, credential.tokenVersion, { ip: input.ip, userAgent: input.userAgent });
  }

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
    const actor = await this.resolveActorForLogin(input.tenantId, input.actorType, input.identifier);
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

    const actor = await this.resolveActorForLogin(input.tenantId, input.actorType, input.identifier);
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

    const outcome = await this.sequelize.transaction((transaction) => this.rotateRefreshTokenWithinTransaction(tokenHash, input, transaction));

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

    // El rol/tenant vigentes se re-resuelven ANTES de emitir un refresh token nuevo.
    // Corrección ATLAS-SEC-REFRESH-001: el flujo anterior creaba el token nuevo y recién después
    // validaba si el actor seguía activo. Si el cliente/usuario había sido cerrado o bloqueado,
    // el método lanzaba error pero podía dejar un refresh token recién creado en la base.
    const refreshedActor = await this.reResolveActorRole(actorType, stored.actorId, stored.tenantId);
    if (!refreshedActor) return { kind: 'actor_unavailable' };

    // Rotación: el refresh token usado queda revocado y se emite uno nuevo, en la misma
    // transacción y con la fila todavía bloqueada. `replacedByTokenId` queda registrado para
    // poder reconstruir la cadena de rotación completa en una investigación de robo de tokens.
    const newRefreshToken = await this.issueRefreshToken(
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

    const accessToken = this.issueAccessToken(refreshedActor, actorType, credential.tokenVersion);
    return { kind: 'success', accessToken, refreshToken: newRefreshToken.token };
  }

  private async reResolveActorRole(actorType: ActorType, actorId: string, tenantId: string | null): Promise<ResolvedActor | null> {
    if (actorType === 'customer') {
      const customer = tenantId ? await this.customersRepository.findById(tenantId, actorId) : null;
      if (!customer || customer.lifecycleStatus === 'closed') return null;
      return { id: actorId, tenantId, role: 'customer', email: null, displayName: null };
    }
    if (actorType === 'internal_user') {
      const internalUser = await this.authRepository.findInternalUserById(actorId);
      if (!internalUser || internalUser.status !== 'active' || !internalUser.roleCode || !isKnownRole(internalUser.roleCode)) return null;
      return {
        id: actorId,
        tenantId: internalUser.tenantId,
        role: internalUser.roleCode,
        email: internalUser.email,
        displayName: internalUser.fullName,
      };
    }
    const platformUser = await this.authRepository.findPlatformUserById(actorId);
    if (!platformUser || platformUser.status !== 'active' || !platformUser.roleCode || !isKnownRole(platformUser.roleCode)) return null;
    return { id: actorId, tenantId: null, role: platformUser.roleCode, email: platformUser.email, displayName: platformUser.fullName };
  }

  async logout(input: { refreshToken: string; allDevices: boolean }): Promise<{ loggedOut: boolean }> {
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
        // Además de revocar refresh tokens, se incrementa `tokenVersion` para que los access
        // tokens ya emitidos (que siguen vigentes hasta su expiración natural, normalmente 1h)
        // también queden invalidados de inmediato. Cierra ATLAS-AUDIT-026 en el caso de uso
        // real que lo motivó: "cerrar sesión en todos los dispositivos".
        //
        // IMPORTANTE: debe pasar por `TokenRevocationService.bumpTokenVersion` (no por
        // `AuthRepository.bumpTokenVersion`) porque `JwtAuthGuard` resuelve la versión vigente
        // consultando primero la caché Redis de este servicio. Escribir el bump solo en la base
        // de datos deja la caché desactualizada hasta su TTL (5 min) y los access tokens
        // supuestamente revocados seguirían aceptándose durante esa ventana.
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
   * correcto es: un `platform_admin` crea (fuera de este patch, vía seed/gestión operativa) la
   * fila en `internal_users`/`platform_users`, y luego usa este endpoint para fijar su
   * contraseña inicial. El propio actor puede luego re-invocar este mismo endpoint sobre sí
   * mismo si se expone `self` como caso adicional (fuera de alcance de este patch, ver
   * `docs/pending/pending-items.md`).
   */
  async provisionCredentials(dto: ProvisionCredentialsDto, requestedBy: { role: AtlasUserRole }): Promise<{ provisioned: boolean }> {
    if (requestedBy.role !== 'admin' && requestedBy.role !== 'platform_admin') {
      throw new ForbiddenException('Solo un administrador puede provisionar credenciales.');
    }

    if (!isPasswordStrongEnough(dto.password)) {
      throw new UnauthorizedException('La contraseña no cumple el mínimo de seguridad requerido.');
    }

    const actor =
      dto.actorType === 'internal_user'
        ? await this.authRepository.findInternalUserById(dto.actorId)
        : await this.authRepository.findPlatformUserById(dto.actorId);

    if (!actor) {
      throw new UnauthorizedException('El actor indicado no existe.');
    }

    const existing = await this.authRepository.findCredentialsByActor(dto.actorType, dto.actorId);
    if (existing) {
      throw new ConflictException('CREDENTIALS_ALREADY_PROVISIONED');
    }

    const tenantId = 'tenantId' in actor ? (actor as { tenantId: string | null }).tenantId : null;
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
