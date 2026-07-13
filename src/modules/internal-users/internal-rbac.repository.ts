import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  AuthCredentialModel,
  InternalPermissionModel,
  InternalRoleModel,
  InternalRolePermissionModel,
  InternalUserModel,
  InternalUserRoleModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';
import { PaginationInput, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { CreateInternalUserInput, InternalAccessProfile } from './internal-users.types.js';

export type InternalRolePermissionRow = {
  roleCode: string;
  legacyRoleCode: string | null;
  permissionCode: string | null;
};

export type InternalAuditInput = {
  tenantId: string;
  actorInternalUserId: string | null;
  actionCode: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))].sort();
}

const permissionAliases: Readonly<Record<string, readonly string[]>> = {
  'internal.users.read': ['rbac.internal_users.read'],
  'internal.users.manage': [
    'rbac.internal_users.create',
    'rbac.internal_users.disable',
    'rbac.internal_users.manage_roles',
    'rbac.internal_users.update',
  ],
  'internal.roles.read': ['rbac.roles.read'],
  'internal.roles.manage': ['rbac.internal_users.manage_roles'],
  'internal.permissions.read': ['rbac.roles.read'],
};

function expandPermissionAliases(permissions: string[]): string[] {
  const expanded = new Set(permissions);
  for (const [canonical, aliases] of Object.entries(permissionAliases)) {
    if (expanded.has(canonical) || aliases.some((alias) => expanded.has(alias))) {
      expanded.add(canonical);
      for (const alias of aliases) expanded.add(alias);
    }
  }
  return [...expanded].sort();
}

function hasPermissionOrAlias(permissions: ReadonlySet<string>, requiredPermission: string): boolean {
  if (permissions.has(requiredPermission)) return true;
  return permissionAliases[requiredPermission]?.some((alias) => permissions.has(alias)) ?? false;
}

@Injectable()
export class InternalRbacRepository {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(InternalUserModel) private readonly internalUserModel: typeof InternalUserModel,
    @InjectModel(InternalRoleModel) private readonly roleModel: typeof InternalRoleModel,
    @InjectModel(InternalPermissionModel) private readonly permissionModel: typeof InternalPermissionModel,
    @InjectModel(InternalRolePermissionModel) private readonly rolePermissionModel: typeof InternalRolePermissionModel,
    @InjectModel(InternalUserRoleModel) private readonly userRoleModel: typeof InternalUserRoleModel,
    @InjectModel(AuthCredentialModel) private readonly credentialModel: typeof AuthCredentialModel,
    @InjectModel(OperationalAuditLogModel) private readonly auditModel: typeof OperationalAuditLogModel,
  ) {}

  async findUserById(tenantId: string, internalUserId: string): Promise<InternalUserModel | null> {
    return this.internalUserModel.findOne({ where: { id: internalUserId, tenantId, deleted: { [Op.ne]: true } } as never });
  }

  async findUserByEmail(tenantId: string, email: string): Promise<InternalUserModel | null> {
    return this.internalUserModel.findOne({
      where: {
        tenantId,
        email: email.trim().toLowerCase(),
        deleted: { [Op.ne]: true },
      } as never,
    });
  }

  async listUsers(tenantId: string, pagination: PaginationInput): Promise<{ rows: InternalUserModel[]; total: number }> {
    const result = await this.internalUserModel.findAndCountAll({
      where: { tenantId, deleted: { [Op.ne]: true } } as never,
      order: [['_id', 'ASC']],
      limit: pagination.limit,
      offset: toOffset(pagination),
    });
    return { rows: result.rows, total: result.count };
  }

  /**
   * Usado por `NotificationBroadcastService` para resolver el destinatario "todos los usuarios
   * internos" de un broadcast de admin, y por `SystemsHealthMonitorService` para avisar a todo
   * el staff cuando una herramienta crítica cae. Solo `status: 'active'` — no tiene sentido
   * notificar cuentas invitadas/suspendidas/bloqueadas que no pueden iniciar sesión de todos
   * modos.
   */
  async listActiveInternalUserIds(tenantId: string): Promise<string[]> {
    const rows = await this.internalUserModel.findAll({
      where: { tenantId, deleted: { [Op.ne]: true }, status: 'active' } as never,
      attributes: ['id'],
    });
    return rows.map((row) => String(row.id));
  }

  async findRolesByCodes(roleCodes: readonly string[], transaction?: Transaction): Promise<InternalRoleModel[]> {
    return this.roleModel.findAll({
      where: {
        roleCode: { [Op.in]: [...roleCodes] },
        status: 'active',
        deleted: false,
      } as never,
      transaction,
    });
  }

  async createUserWithCredentials(input: CreateInternalUserInput): Promise<InternalUserModel> {
    return this.sequelize.transaction(async (transaction) => {
      const now = new Date();
      const user = await this.internalUserModel.create(
        {
          tenantId: input.tenantId,
          userCode: input.userCode,
          fullName: input.fullName,
          email: input.email,
          roleCode: input.legacyRoleCode,
          status: 'active',
          department: input.department,
          jobTitle: input.jobTitle,
          lastLoginAt: null,
          passwordChangedAt: null,
          mustChangePassword: input.mustChangePassword,
          mfaEnabled: false,
          createdByInternalUserId: input.createdByInternalUserId,
          updatedByInternalUserId: input.createdByInternalUserId,
          createdAtValue: now,
          updatedAtValue: now,
          deleted: false,
        } as never,
        { transaction },
      );

      await this.credentialModel.create(
        {
          tenantId: input.tenantId,
          actorType: 'internal_user',
          actorId: user.id,
          passwordHash: input.passwordHash,
          tokenVersion: 1,
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: null,
          lastLoginIp: null,
          createdAtValue: now,
          updatedAtValue: now,
          deleted: false,
        } as never,
        { transaction },
      );

      await this.assignRolesInTransaction({
        tenantId: input.tenantId,
        internalUserId: user.id,
        roleCodes: input.roleCodes,
        assignedByInternalUserId: input.createdByInternalUserId,
        transaction,
      });

      return user;
    });
  }

  async updateUser(
    user: InternalUserModel,
    values: {
      fullName?: string;
      department?: string;
      jobTitle?: string | null;
      status?: string;
      mustChangePassword?: boolean;
      updatedByInternalUserId: string | null;
    },
  ): Promise<InternalUserModel> {
    if (values.fullName !== undefined) user.fullName = values.fullName;
    if (values.department !== undefined) user.department = values.department;
    if (values.jobTitle !== undefined) user.jobTitle = values.jobTitle;
    if (values.status !== undefined) user.status = values.status;
    if (values.mustChangePassword !== undefined) user.mustChangePassword = values.mustChangePassword;
    user.updatedByInternalUserId = values.updatedByInternalUserId;
    user.updatedAtValue = new Date();
    await user.save();
    return user;
  }

  async replaceUserRoles(input: {
    tenantId: string;
    internalUserId: string;
    roleCodes: string[];
    assignedByInternalUserId: string | null;
    legacyRoleCode: string;
    reason: string;
  }): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      const now = new Date();
      await this.userRoleModel.update(
        {
          revokedAt: now,
          revokedByInternalUserId: input.assignedByInternalUserId,
          revocationReason: input.reason,
          updatedAtValue: now,
        } as never,
        {
          where: {
            tenantId: input.tenantId,
            internalUserId: input.internalUserId,
            revokedAt: null,
          } as never,
          transaction,
        },
      );

      await this.assignRolesInTransaction({
        tenantId: input.tenantId,
        internalUserId: input.internalUserId,
        roleCodes: input.roleCodes,
        assignedByInternalUserId: input.assignedByInternalUserId,
        transaction,
      });

      await this.internalUserModel.update(
        { roleCode: input.legacyRoleCode, updatedByInternalUserId: input.assignedByInternalUserId, updatedAtValue: now } as never,
        { where: { id: input.internalUserId, tenantId: input.tenantId } as never, transaction },
      );
    });
  }

  private async assignRolesInTransaction(input: {
    tenantId: string;
    internalUserId: string;
    roleCodes: string[];
    assignedByInternalUserId: string | null;
    transaction: Transaction;
  }): Promise<void> {
    const roles = await this.findRolesByCodes(input.roleCodes, input.transaction);
    const now = new Date();
    const rows = roles.map((role) => ({
      tenantId: input.tenantId,
      internalUserId: input.internalUserId,
      roleId: role.id,
      assignedByInternalUserId: input.assignedByInternalUserId,
      assignedAt: now,
      revokedAt: null,
      revokedByInternalUserId: null,
      revocationReason: null,
      createdAtValue: now,
      updatedAtValue: now,
    }));

    if (rows.length > 0) {
      await this.userRoleModel.bulkCreate(rows as never[], { transaction: input.transaction });
    }
  }

  async getRolePermissionRows(tenantId: string, internalUserId: string): Promise<InternalRolePermissionRow[]> {
    return this.sequelize.query<InternalRolePermissionRow>(
      `
        SELECT r.role_code AS "roleCode", r.legacy_role_code AS "legacyRoleCode", p.permission_code AS "permissionCode"
        FROM internal_user_roles ur
        JOIN internal_roles r
          ON r._id = ur.role_id
         AND r.status = 'active'
         AND r._deleted = false
        LEFT JOIN internal_role_permissions rp
          ON rp.role_id = r._id
        LEFT JOIN internal_permissions p
          ON p._id = rp.permission_id
         AND p.status = 'active'
         AND p._deleted = false
        WHERE ur._tenant_id = :tenantId
          AND ur.internal_user_id = :internalUserId
          AND ur.revoked_at IS NULL
        ORDER BY r.role_code ASC, p.permission_code ASC
      `,
      { replacements: { tenantId, internalUserId }, type: QueryTypes.SELECT },
    );
  }

  /**
   * Batch de `getRolePermissionRows` para varios usuarios a la vez (una sola query con
   * `internal_user_id IN (...)`, en vez de una por usuario). Usada por `buildAccessProfiles` para
   * que `listUsers` no dispare un N+1 (hasta 250 round trips antes de agregar paginación) al
   * construir el perfil de acceso de cada fila de la página.
   */
  private async getRolePermissionRowsForUsers(
    tenantId: string,
    internalUserIds: readonly string[],
  ): Promise<Array<InternalRolePermissionRow & { internalUserId: string }>> {
    if (internalUserIds.length === 0) return [];
    return this.sequelize.query<InternalRolePermissionRow & { internalUserId: string }>(
      `
        SELECT ur.internal_user_id AS "internalUserId",
               r.role_code AS "roleCode", r.legacy_role_code AS "legacyRoleCode", p.permission_code AS "permissionCode"
        FROM internal_user_roles ur
        JOIN internal_roles r
          ON r._id = ur.role_id
         AND r.status = 'active'
         AND r._deleted = false
        LEFT JOIN internal_role_permissions rp
          ON rp.role_id = r._id
        LEFT JOIN internal_permissions p
          ON p._id = rp.permission_id
         AND p.status = 'active'
         AND p._deleted = false
        WHERE ur._tenant_id = :tenantId
          AND ur.internal_user_id IN (:internalUserIds)
          AND ur.revoked_at IS NULL
        ORDER BY ur.internal_user_id ASC, r.role_code ASC, p.permission_code ASC
      `,
      { replacements: { tenantId, internalUserIds: [...internalUserIds] }, type: QueryTypes.SELECT },
    );
  }

  private mapAccessProfile(user: InternalUserModel, rows: InternalRolePermissionRow[]): InternalAccessProfile {
    const permissions = expandPermissionAliases(uniqueSorted(rows.map((row) => row.permissionCode)));
    return {
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email ?? '',
        fullName: user.fullName ?? '',
        name: user.fullName ?? '',
        userCode: user.userCode,
        status: user.status ?? 'unknown',
        department: user.department,
        jobTitle: user.jobTitle,
        mustChangePassword: user.mustChangePassword,
        mfaEnabled: user.mfaEnabled,
        roles: uniqueSorted(rows.map((row) => row.roleCode)),
        legacyRoles: uniqueSorted(rows.map((row) => row.legacyRoleCode)),
        permissions,
      },
    };
  }

  async buildAccessProfile(user: InternalUserModel): Promise<InternalAccessProfile> {
    const rows = await this.getRolePermissionRows(user.tenantId, user.id);
    return this.mapAccessProfile(user, rows);
  }

  async buildAccessProfiles(users: readonly InternalUserModel[]): Promise<InternalAccessProfile[]> {
    if (users.length === 0) return [];
    const tenantId = users[0]!.tenantId;
    const rows = await this.getRolePermissionRowsForUsers(
      tenantId,
      users.map((user) => user.id),
    );
    const rowsByUser = new Map<string, InternalRolePermissionRow[]>();
    for (const row of rows) {
      const existing = rowsByUser.get(row.internalUserId);
      if (existing) {
        existing.push(row);
      } else {
        rowsByUser.set(row.internalUserId, [row]);
      }
    }
    return users.map((user) => this.mapAccessProfile(user, rowsByUser.get(user.id) ?? []));
  }

  async hasPermissions(tenantId: string, internalUserId: string, requiredPermissions: readonly string[]): Promise<boolean> {
    const rows = await this.getRolePermissionRows(tenantId, internalUserId);
    const permissions = new Set(rows.map((row) => row.permissionCode).filter((value): value is string => typeof value === 'string'));
    return requiredPermissions.every((permission) => hasPermissionOrAlias(permissions, permission));
  }

  async createAudit(input: InternalAuditInput): Promise<void> {
    const now = new Date();
    await this.auditModel.create({
      tenantId: input.tenantId,
      actorType: input.actorInternalUserId ? 'internal_user' : 'system',
      actorInternalUserId: input.actorInternalUserId,
      actorPlatformUserId: null,
      actionCode: input.actionCode,
      targetType: input.targetType,
      targetId: input.targetId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      payloadJson: { reason: input.reason, ...(input.metadata ?? {}) },
      occurredAt: now,
      createdAtValue: now,
    } as never);
  }
}
