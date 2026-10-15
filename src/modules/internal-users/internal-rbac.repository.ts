/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
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
import { PaginationInput } from '../../common/utils/pagination/pagination.util.js';
import { CreateInternalUserInput, InternalAccessProfile, InternalAuditInput } from './internal-users.types.js';
import { hasPermissionOrAlias } from '../../common/utils/permission-aliases.js';
import { ROLE_PERMISSIONS_FOR_USER_SQL, ROLE_PERMISSIONS_FOR_USERS_SQL } from './internal-rbac.sql.js';
import { InternalRolePermissionRow, groupRolePermissionRowsByUser, mapAccessProfile } from './internal-access-profile.mapper.js';
import { InternalUsersListFilter, ListedUsers, internalUsersListQuery } from './internal-users-list.filter.js';

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

  async listUsers(tenantId: string, pagination: PaginationInput, filter: InternalUsersListFilter = {}): Promise<ListedUsers> {
    const result = await this.internalUserModel.findAndCountAll({
      ...internalUsersListQuery(tenantId, filter, pagination),
      order: [['_id', 'ASC']],
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
    return this.sequelize.query<InternalRolePermissionRow>(ROLE_PERMISSIONS_FOR_USER_SQL, {
      replacements: { tenantId, internalUserId },
      type: QueryTypes.SELECT,
    });
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
    return this.sequelize.query<InternalRolePermissionRow & { internalUserId: string }>(ROLE_PERMISSIONS_FOR_USERS_SQL, {
      replacements: { tenantId, internalUserIds: [...internalUserIds] },
      type: QueryTypes.SELECT,
    });
  }

  async buildAccessProfile(user: InternalUserModel): Promise<InternalAccessProfile> {
    const rows = await this.getRolePermissionRows(user.tenantId, user.id);
    return mapAccessProfile(user, rows);
  }

  async buildAccessProfiles(users: readonly InternalUserModel[]): Promise<InternalAccessProfile[]> {
    if (users.length === 0) return [];
    const tenantId = users[0]!.tenantId;
    const rows = await this.getRolePermissionRowsForUsers(
      tenantId,
      users.map((user) => user.id),
    );
    const rowsByUser = groupRolePermissionRowsByUser(rows);
    return users.map((user) => mapAccessProfile(user, rowsByUser.get(user.id) ?? []));
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
