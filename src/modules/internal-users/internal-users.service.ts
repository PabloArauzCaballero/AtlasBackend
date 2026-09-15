/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { hashPassword, isPasswordStrongEnough } from '../../common/utils/crypto/password.util.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { buildPaginationMeta, PaginationInput, PaginationMeta } from '../../common/utils/pagination/pagination.util.js';
import { TokenRevocationService } from '../../common/services/token-revocation.service.js';
import { AuthSecondFactorService } from '../auth/auth-second-factor.service.js';
import { CredentialsNotifierService } from '../auth/credentials-notifier.service.js';
import { withEffectiveSecondFactor } from './internal-profile-second-factor.js';
import { legacyRoleForInternalRoles } from './internal-rbac.seed-data.js';
import { assertCanAssignRequestedRoles, assertInternalActor, disabledLikeStatuses, uniqueRoleCodes } from './internal-users.policy.js';
import { InternalRbacRepository } from './internal-rbac.repository.js';
import { CreateInternalUserDto, ReplaceInternalUserRolesDto, UpdateInternalUserDto } from './internal-users.schemas.js';
import { InternalAccessProfile, InternalUserListItem } from './internal-users.types.js';

@Injectable()
export class InternalUsersService {
  constructor(
    private readonly rbacRepository: InternalRbacRepository,
    private readonly tokenRevocationService: TokenRevocationService,
    private readonly secondFactor: AuthSecondFactorService,
    private readonly credentialsNotifier: CredentialsNotifierService,
  ) {}

  /** Ver `internal-profile-second-factor.ts`: se informa el estado efectivo, no la columna. */
  private withSecondFactor<T extends InternalAccessProfile>(profile: T): T {
    return withEffectiveSecondFactor(profile, this.secondFactor.isRequired('internal_user', {}));
  }

  async getMyProfile(currentUser: AuthenticatedUser): Promise<InternalAccessProfile> {
    const actor = assertInternalActor(currentUser);
    const user = await this.rbacRepository.findUserById(actor.tenantId, actor.internalUserId);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('El usuario interno ya no está activo.');
    }

    return this.withSecondFactor(await this.rbacRepository.buildAccessProfile(user));
  }

  async listUsers(
    currentUser: AuthenticatedUser,
    pagination: PaginationInput,
  ): Promise<{ items: InternalUserListItem[]; meta: PaginationMeta }> {
    const actor = assertInternalActor(currentUser);
    const { rows, total } = await this.rbacRepository.listUsers(actor.tenantId, pagination);
    // Batch: una sola query de roles/permisos para toda la página en vez de una por usuario
    // (antes, `Promise.all(users.map(buildAccessProfile))` disparaba hasta `limit` round trips).
    const profiles = await this.rbacRepository.buildAccessProfiles(rows);
    const items = profiles.map((profile) => this.withSecondFactor(profile).user);
    return { items, meta: buildPaginationMeta(pagination, total) };
  }

  async getUser(currentUser: AuthenticatedUser, internalUserId: string): Promise<InternalAccessProfile> {
    const actor = assertInternalActor(currentUser);
    const user = await this.rbacRepository.findUserById(actor.tenantId, parsePositiveId(internalUserId, 'internalUserId'));
    if (!user) throw new NotFoundException('Usuario interno no encontrado.');
    return this.withSecondFactor(await this.rbacRepository.buildAccessProfile(user));
  }

  async createUser(
    currentUser: AuthenticatedUser,
    dto: CreateInternalUserDto,
    requestContext: { ipAddress: string | null; userAgent: string | null },
  ): Promise<InternalAccessProfile> {
    const actor = assertInternalActor(currentUser);
    const tenantId = parsePositiveId(dto.tenantId ?? actor.tenantId, 'tenantId');
    if (tenantId !== actor.tenantId) {
      throw new ForbiddenException('No puedes crear usuarios internos fuera de tu tenant.');
    }

    if (!isPasswordStrongEnough(dto.password)) {
      throw new UnauthorizedException('La contraseña no cumple el mínimo de seguridad requerido.');
    }

    const roleCodes = uniqueRoleCodes(dto.roles);
    if (roleCodes.length !== new Set(dto.roles).size) {
      throw new ForbiddenException('Uno o más roles internos no son válidos.');
    }

    const existing = await this.rbacRepository.findUserByEmail(tenantId, dto.email);
    if (existing) {
      throw new ConflictException('INTERNAL_USER_EMAIL_ALREADY_EXISTS');
    }

    const roles = await this.rbacRepository.findRolesByCodes(roleCodes);
    if (roles.length !== roleCodes.length) {
      throw new ForbiddenException('Uno o más roles internos no están activos.');
    }
    await assertCanAssignRequestedRoles(this.rbacRepository, actor, roleCodes);

    const passwordHash = await hashPassword(dto.password);
    const user = await this.rbacRepository.createUserWithCredentials({
      tenantId,
      email: dto.email,
      fullName: dto.fullName,
      userCode: dto.userCode ?? dto.email.split('@')[0],
      department: dto.department,
      jobTitle: dto.jobTitle ?? null,
      passwordHash,
      mustChangePassword: dto.mustChangePassword,
      roleCodes,
      legacyRoleCode: legacyRoleForInternalRoles(roleCodes),
      createdByInternalUserId: actor.internalUserId,
    });

    await this.rbacRepository.createAudit({
      tenantId,
      actorInternalUserId: actor.internalUserId,
      actionCode: 'internal_users.create',
      targetType: 'internal_user',
      targetId: user.id,
      reason: dto.reason,
      metadata: { email: dto.email, roles: roleCodes },
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    // Después de auditar el alta y sin deshacerla si el correo falla. Hasta el 2026-09-14 nadie
    // llamaba a este envío: el portal mostraba la contraseña una vez y el responsable no recibía nada.
    await this.credentialsNotifier.sendInitialCredentials({
      to: dto.email,
      recipientName: dto.fullName,
      temporaryPassword: dto.password,
      reference: `internal-user:${user.id}`,
    });

    return this.rbacRepository.buildAccessProfile(user);
  }

  async updateUser(
    currentUser: AuthenticatedUser,
    internalUserId: string,
    dto: UpdateInternalUserDto,
    requestContext: { ipAddress: string | null; userAgent: string | null },
  ): Promise<InternalAccessProfile> {
    const actor = assertInternalActor(currentUser);
    const targetUserId = parsePositiveId(internalUserId, 'internalUserId');
    const user = await this.rbacRepository.findUserById(actor.tenantId, targetUserId);
    if (!user) throw new NotFoundException('Usuario interno no encontrado.');

    if (targetUserId === actor.internalUserId && dto.status && disabledLikeStatuses.has(dto.status)) {
      throw new ForbiddenException('No puedes suspender, bloquear o desactivar tu propia cuenta interna.');
    }

    if (dto.status && disabledLikeStatuses.has(dto.status)) {
      const canDisable = await this.rbacRepository.hasPermissions(actor.tenantId, actor.internalUserId, ['internal.users.manage']);
      if (!canDisable) {
        throw new ForbiddenException('Desactivar, suspender o bloquear usuarios requiere el permiso internal.users.manage.');
      }
    }

    const updated = await this.rbacRepository.updateUser(user, {
      fullName: dto.fullName,
      department: dto.department,
      jobTitle: dto.jobTitle,
      status: dto.status,
      mustChangePassword: dto.mustChangePassword,
      updatedByInternalUserId: actor.internalUserId,
    });

    if (dto.status && disabledLikeStatuses.has(dto.status)) {
      // Sin esto, un access token ya emitido para este usuario sigue siendo válido para
      // `JwtAuthGuard` hasta su expiración natural (por defecto 1h) pese a que el admin lo
      // acaba de suspender/bloquear/deshabilitar.
      // cerró para "logout en todos los dispositivos", pero que nunca se aplicó a este flujo.
      // `IfPresent`: un usuario interno creado por seed y todavía sin contraseña provisionada no
      // tiene fila en `auth_credentials`. Con la variante que lanza, suspenderlo devolvía 500 con el
      // estado ya escrito y sin registrar la auditoría, aparentando un fallo donde no lo hubo. Sin
      // credenciales no hay sesión que revocar, así que no queda nada pendiente.
      await this.tokenRevocationService.bumpTokenVersionIfPresent('internal_user', targetUserId);
    }

    await this.rbacRepository.createAudit({
      tenantId: actor.tenantId,
      actorInternalUserId: actor.internalUserId,
      actionCode: 'internal_users.update',
      targetType: 'internal_user',
      targetId: user.id,
      reason: dto.reason,
      metadata: { changedFields: Object.keys(dto).filter((key) => key !== 'reason') },
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    return this.rbacRepository.buildAccessProfile(updated);
  }

  async replaceRoles(
    currentUser: AuthenticatedUser,
    internalUserId: string,
    dto: ReplaceInternalUserRolesDto,
    requestContext: { ipAddress: string | null; userAgent: string | null },
  ): Promise<InternalAccessProfile> {
    const actor = assertInternalActor(currentUser);
    const targetUserId = parsePositiveId(internalUserId, 'internalUserId');
    const user = await this.rbacRepository.findUserById(actor.tenantId, targetUserId);
    if (!user) throw new NotFoundException('Usuario interno no encontrado.');

    const roleCodes = uniqueRoleCodes(dto.roles);
    if (roleCodes.length !== new Set(dto.roles).size) {
      throw new ForbiddenException('Uno o más roles internos no son válidos.');
    }

    if (targetUserId === actor.internalUserId) {
      throw new ForbiddenException('No puedes reemplazar tus propios roles internos desde este endpoint.');
    }

    const roles = await this.rbacRepository.findRolesByCodes(roleCodes);
    if (roles.length !== roleCodes.length) {
      throw new ForbiddenException('Uno o más roles internos no están activos.');
    }
    const currentProfile = await this.rbacRepository.buildAccessProfile(user);
    await assertCanAssignRequestedRoles(this.rbacRepository, actor, roleCodes, currentProfile.user.roles);

    await this.rbacRepository.replaceUserRoles({
      tenantId: actor.tenantId,
      internalUserId: targetUserId,
      roleCodes,
      assignedByInternalUserId: actor.internalUserId,
      legacyRoleCode: legacyRoleForInternalRoles(roleCodes),
      reason: dto.reason,
    });

    // Mismo motivo que en `updateUser` al suspender, aplicado a la degradación de privilegios:
    // `replaceUserRoles` reescribe `internal_users.role_code`, que es de donde sale el claim `role`
    // del access token (`auth-actor-resolver.service.ts` → `AuthService.issueAccessToken`), pero
    // `RolesGuard` autoriza leyendo ese claim del token, no la base. Sin este bump, degradar a un
    // administrador lo deja operando con su rol anterior hasta que el token expire por su cuenta
    // (`JWT_ACCESS_TOKEN_EXPIRES_IN`) — y en esa ventana conserva endpoints como
    // `POST /auth/provision-credentials` (`@Roles('admin', 'platform_admin')`), con los que puede
    // fabricarse acceso que sobreviva a la propia degradación.
    //
    // Se revoca ante CUALQUIER reemplazo de roles, no solo cuando cambia el claim: dos conjuntos de
    // roles distintos pueden colapsar al mismo rol legacy (`legacyRoleForInternalRoles`) y aun así
    // recortar privilegios. El coste de revocar de más es un refresh silencioso — el flujo de
    // refresh re-resuelve el rol vigente y emite el token con la versión nueva, así que el usuario
    // no queda deslogueado, solo actualizado.
    await this.tokenRevocationService.bumpTokenVersionIfPresent('internal_user', targetUserId);

    await this.rbacRepository.createAudit({
      tenantId: actor.tenantId,
      actorInternalUserId: actor.internalUserId,
      actionCode: 'internal_users.roles.replace',
      targetType: 'internal_user',
      targetId: targetUserId,
      reason: dto.reason,
      metadata: { roles: roleCodes },
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    const refreshedUser = await this.rbacRepository.findUserById(actor.tenantId, targetUserId);
    if (!refreshedUser) throw new NotFoundException('Usuario interno no encontrado.');
    return this.rbacRepository.buildAccessProfile(refreshedUser);
  }
}
