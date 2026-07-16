import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { hashPassword, isPasswordStrongEnough } from '../../common/utils/crypto/password.util.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { buildPaginationMeta, PaginationInput, PaginationMeta } from '../../common/utils/pagination/pagination.util.js';
import { TokenRevocationService } from '../../common/services/token-revocation.service.js';
import { INTERNAL_ROLE_CODES, legacyRoleForInternalRoles } from './internal-rbac.seed-data.js';
import { InternalRbacRepository } from './internal-rbac.repository.js';
import { CreateInternalUserDto, ReplaceInternalUserRolesDto, UpdateInternalUserDto } from './internal-users.schemas.js';
import { InternalAccessProfile, InternalUserListItem } from './internal-users.types.js';

const roleCodeSet = new Set<string>(INTERNAL_ROLE_CODES);
const privilegedRoleCodes = new Set(['SUPER_ADMIN', 'SYSTEMS_ADMIN', 'INTERNAL_IDENTITY_ADMIN']);
const disabledLikeStatuses = new Set(['suspended', 'locked', 'disabled']);

function assertInternalActor(user: AuthenticatedUser): { tenantId: string; internalUserId: string } {
  if (!user.tenantId || !user.internalUserId) {
    throw new ForbiddenException('Esta operación requiere una sesión de usuario interno.');
  }

  return { tenantId: parsePositiveId(user.tenantId, 'tenantId'), internalUserId: parsePositiveId(user.internalUserId, 'internalUserId') };
}

function uniqueRoleCodes(roleCodes: readonly string[]): string[] {
  return [...new Set(roleCodes)].filter((roleCode) => roleCodeSet.has(roleCode));
}

async function getActorRoleCodes(rbacRepository: InternalRbacRepository, tenantId: string, internalUserId: string): Promise<string[]> {
  const actorUser = await rbacRepository.findUserById(tenantId, internalUserId);
  if (!actorUser || actorUser.status !== 'active') {
    throw new ForbiddenException('El usuario interno actual ya no está activo.');
  }

  return (await rbacRepository.buildAccessProfile(actorUser)).user.roles;
}

/**
 * Exige SUPER_ADMIN cuando la operación TOCA un rol privilegiado — ya sea porque se está
 * asignando (`roleCodes`) o porque el usuario objetivo ya lo tenía y `replaceRoles` lo va a
 * quitar (`currentRoleCodes`, vacío en creación de usuario nuevo). Antes solo se miraba
 * `roleCodes`: un actor con `internal.users.manage` + `internal.roles.manage` pero SIN
 * SUPER_ADMIN (p. ej. el rol `INTERNAL_IDENTITY_ADMIN`) podía llamar a `replaceRoles` con una
 * lista de roles no privilegiados sobre un usuario que sí tenía SUPER_ADMIN/SYSTEMS_ADMIN, y el
 * chequeo se saltaba por completo porque la lista NUEVA no "asignaba" ningún rol crítico —
 * despojando en silencio el rol privilegiado del objetivo sin nunca haber tenido que probar ser
 * SUPER_ADMIN. Con `currentRoleCodes` en el chequeo, quitar un rol privilegiado exige lo mismo
 * que asignarlo.
 */
async function assertCanAssignRequestedRoles(
  rbacRepository: InternalRbacRepository,
  actor: { tenantId: string; internalUserId: string },
  roleCodes: readonly string[],
  currentRoleCodes: readonly string[] = [],
): Promise<void> {
  const touchesPrivilegedRole =
    roleCodes.some((roleCode) => privilegedRoleCodes.has(roleCode)) ||
    currentRoleCodes.some((roleCode) => privilegedRoleCodes.has(roleCode));
  if (!touchesPrivilegedRole) return;

  const actorRoleCodes = await getActorRoleCodes(rbacRepository, actor.tenantId, actor.internalUserId);
  if (!actorRoleCodes.includes('SUPER_ADMIN')) {
    throw new ForbiddenException('Solo SUPER_ADMIN puede asignar o quitar roles administrativos críticos.');
  }
}

@Injectable()
export class InternalUsersService {
  constructor(
    private readonly rbacRepository: InternalRbacRepository,
    private readonly tokenRevocationService: TokenRevocationService,
  ) {}

  async getMyProfile(currentUser: AuthenticatedUser): Promise<InternalAccessProfile> {
    const actor = assertInternalActor(currentUser);
    const user = await this.rbacRepository.findUserById(actor.tenantId, actor.internalUserId);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('El usuario interno ya no está activo.');
    }

    return this.rbacRepository.buildAccessProfile(user);
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
    return { items: profiles.map((profile) => profile.user), meta: buildPaginationMeta(pagination, total) };
  }

  async getUser(currentUser: AuthenticatedUser, internalUserId: string): Promise<InternalAccessProfile> {
    const actor = assertInternalActor(currentUser);
    const user = await this.rbacRepository.findUserById(actor.tenantId, parsePositiveId(internalUserId, 'internalUserId'));
    if (!user) throw new NotFoundException('Usuario interno no encontrado.');
    return this.rbacRepository.buildAccessProfile(user);
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
      await this.tokenRevocationService.bumpTokenVersion('internal_user', targetUserId);
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
