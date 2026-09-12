/**
 * @file La CREDENCIAL: darla, recuperarla y decidir si pide segundo factor.
 * @business Esta pieza deja trazabilidad de la atención y su resultado.
 * @system implementa este tramo del caso de uso de soporte.
 */
import { Injectable, UnauthorizedException, ForbiddenException, ConflictException, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { MetricsService } from '../../common/observability/metrics.service.js';

import { Sequelize } from 'sequelize-typescript';

import { AtlasUserRole } from '../../common/types/auth.types.js';
import { hashPassword, isPasswordStrongEnough } from '../../common/utils/crypto/password.util.js';

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
  PasswordResetConfirmedResponseDto,
  PasswordResetRequestedResponseDto,
  ProvisionCredentialsResponseDto,
} from './auth.dtos.js';
import { ProvisionCredentialsDto } from './auth.schemas.js';

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

/**
 * Sale de `AuthService` porque aquel archivo mezclaba dos ciclos de vida distintos: la SESIÓN
 * —entrar, refrescar, salir— y la credencial con la que se entra. Juntos pasaban del límite de
 * `check:file-size`, y son las dos mitades por las que se busca cuando algo de acceso falla.
 */
@Injectable()
export class AuthCredentialsService {
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

  /**
   * MFA opt-in del cliente. Delegado en `AuthSecondFactorService` (ver ese archivo para la política
   * completa del segundo factor).
   */
  setCustomerMfaPreference(input: { actorId: string; enabled: boolean }): Promise<{ mfaEnabled: boolean }> {
    return this.secondFactor.setCustomerMfaPreference(input);
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
