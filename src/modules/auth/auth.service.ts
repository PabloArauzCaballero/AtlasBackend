import { Injectable, UnauthorizedException, ForbiddenException, ConflictException } from '@nestjs/common';
import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AtlasUserRole } from '../../common/types/auth.types.js';
import { hashPassword, isPasswordStrongEnough, verifyPassword } from '../../common/utils/crypto/password.util.js';
import { generateRefreshToken, hashRefreshToken } from '../../common/utils/crypto/refresh-token.util.js';
import { hashSensitiveText } from '../../common/utils/crypto/hash.util.js';
import { TokenRevocationService } from '../../common/services/token-revocation.service.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { ActorType, AuthRepository } from './auth.repository.js';
import { LoginDto, ProvisionCredentialsDto } from './auth.schemas.js';

type ResolvedActor = {
  id: string;
  tenantId: string | null;
  role: AtlasUserRole;
};

type LoginResult = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
};

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
  ) {}

  private async resolveActorForLogin(tenantId: string, actorType: ActorType, identifier: string): Promise<ResolvedActor | null> {
    if (actorType === 'customer') {
      const identifierHash = hashSensitiveText(identifier);
      const customer = await this.customersRepository.findByContactHash(tenantId, {
        phoneHash: identifierHash,
        emailHash: identifierHash,
      });
      if (!customer || customer.lifecycleStatus === 'closed') return null;
      return { id: customer.id, tenantId: customer.tenantId, role: 'customer' };
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
      return { id: internalUser.id, tenantId: internalUser.tenantId, role: internalUser.roleCode };
    }

    // platform_user
    const platformUser = await this.authRepository.findPlatformUserByEmail(identifier);
    if (!platformUser || platformUser.status !== 'active' || !platformUser.roleCode || !isKnownRole(platformUser.roleCode)) {
      return null;
    }
    return { id: platformUser.id, tenantId: null, role: platformUser.roleCode };
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

  private async issueRefreshToken(input: {
    tenantId: string | null;
    actorType: ActorType;
    actorId: string;
    userAgent: string | null;
    ipAddress: string | null;
  }): Promise<{ token: string; id: string }> {
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + env.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);
    const created = await this.authRepository.createRefreshToken({
      tenantId: input.tenantId,
      actorType: input.actorType,
      actorId: input.actorId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });
    return { token: refreshToken, id: created.id };
  }

  async login(input: { tenantId: string; dto: LoginDto; ip: string | null; userAgent: string | null }): Promise<LoginResult> {
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

    await this.authRepository.recordSuccessfulLogin(credential, input.ip);
    await logAttempt(null);

    const accessToken = this.issueAccessToken(actor, input.dto.actorType, credential.tokenVersion);
    const issuedRefreshToken = await this.issueRefreshToken({
      tenantId: actor.tenantId,
      actorType: input.dto.actorType,
      actorId: actor.id,
      userAgent: input.userAgent,
      ipAddress: input.ip,
    });

    return { accessToken, refreshToken: issuedRefreshToken.token, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN };
  }

  async refresh(input: { refreshToken: string; ip: string | null; userAgent: string | null }): Promise<LoginResult> {
    const tokenHash = hashRefreshToken(input.refreshToken);
    const stored = await this.authRepository.findActiveRefreshTokenByHash(tokenHash);

    if (!stored || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }

    const actorType = stored.actorType as ActorType;
    const credential = await this.authRepository.findCredentialsByActor(actorType, stored.actorId);
    if (!credential) {
      throw new UnauthorizedException('Refresh token inválido.');
    }

    // El rol/tenant vigentes se re-resuelven ANTES de emitir un refresh token nuevo.
    // Corrección ATLAS-SEC-REFRESH-001: el flujo anterior creaba el token nuevo y recién después
    // validaba si el actor seguía activo. Si el cliente/usuario había sido cerrado o bloqueado,
    // el método lanzaba error pero podía dejar un refresh token recién creado en la base.
    const refreshedActor = await this.reResolveActorRole(actorType, stored.actorId, stored.tenantId);
    if (!refreshedActor) {
      throw new UnauthorizedException('El actor asociado a este token ya no está disponible.');
    }

    // Rotación: el refresh token usado queda revocado y se emite uno nuevo. Si este mismo
    // token se presenta de nuevo más adelante (indicio de robo/reuso), la próxima llamada
    // fallará porque ya no está activo — comportamiento estándar de rotación de refresh tokens.
    // `replacedByTokenId` queda registrado para poder reconstruir la cadena de rotación completa
    // en una investigación de robo de tokens (antes se guardaba siempre `null`, ver auditoría).
    const newRefreshToken = await this.issueRefreshToken({
      tenantId: refreshedActor.tenantId,
      actorType,
      actorId: refreshedActor.id,
      userAgent: input.userAgent,
      ipAddress: input.ip,
    });
    await this.authRepository.revokeRefreshToken(stored, 'rotated', newRefreshToken.id);

    const accessToken = this.issueAccessToken(refreshedActor, actorType, credential.tokenVersion);
    return { accessToken, refreshToken: newRefreshToken.token, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN };
  }

  private async reResolveActorRole(actorType: ActorType, actorId: string, tenantId: string | null): Promise<ResolvedActor | null> {
    if (actorType === 'customer') {
      const customer = tenantId ? await this.customersRepository.findById(tenantId, actorId) : null;
      if (!customer || customer.lifecycleStatus === 'closed') return null;
      return { id: actorId, tenantId, role: 'customer' };
    }
    if (actorType === 'internal_user') {
      const internalUser = await this.authRepository.findInternalUserById(actorId);
      if (!internalUser || internalUser.status !== 'active' || !internalUser.roleCode || !isKnownRole(internalUser.roleCode)) return null;
      return { id: actorId, tenantId: internalUser.tenantId, role: internalUser.roleCode };
    }
    const platformUser = await this.authRepository.findPlatformUserById(actorId);
    if (!platformUser || platformUser.status !== 'active' || !platformUser.roleCode || !isKnownRole(platformUser.roleCode)) return null;
    return { id: actorId, tenantId: null, role: platformUser.roleCode };
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
