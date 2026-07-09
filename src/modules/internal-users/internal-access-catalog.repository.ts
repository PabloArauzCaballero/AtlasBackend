import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { InternalPermissionModel } from '../../database/models/index.js';
import { InternalPermissionListItem, InternalRoleCatalogRow } from './internal-access-catalog.types.js';

function permissionItem(model: InternalPermissionModel): InternalPermissionListItem {
  return {
    id: model.id,
    code: model.permissionCode,
    module: model.moduleCode,
    resource: model.resourceCode,
    action: model.actionCode,
    description: model.description,
    riskLevel: model.riskLevel,
    requiresReason: model.requiresReason,
    requiresMfa: model.requiresMfa,
  };
}

@Injectable()
export class InternalAccessCatalogRepository {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(InternalPermissionModel) private readonly permissionModel: typeof InternalPermissionModel,
  ) {}

  listRoleRows(): Promise<InternalRoleCatalogRow[]> {
    return this.queryRoleRows('WHERE r._deleted = false', {});
  }

  findRoleRowsById(roleId: string): Promise<InternalRoleCatalogRow[]> {
    return this.queryRoleRows('WHERE r._id = :roleId AND r._deleted = false', { roleId });
  }

  async listPermissions(): Promise<InternalPermissionListItem[]> {
    const permissions = await this.permissionModel.findAll({
      where: { deleted: { [Op.ne]: true }, status: 'active' } as never,
      order: [
        ['module_code', 'ASC'],
        ['resource_code', 'ASC'],
        ['action_code', 'ASC'],
      ],
      limit: 1000,
    });
    return permissions.map(permissionItem);
  }

  private queryRoleRows(whereSql: string, replacements: Record<string, string>): Promise<InternalRoleCatalogRow[]> {
    return this.sequelize.query<InternalRoleCatalogRow>(
      `
        SELECT
          r._id AS "id",
          r.role_code AS "code",
          r.role_name AS "name",
          r.description AS "description",
          r.department AS "department",
          r.legacy_role_code AS "legacyRoleCode",
          r.status AS "status",
          p.permission_code AS "permissionCode"
        FROM internal_roles r
        LEFT JOIN internal_role_permissions rp ON rp.role_id = r._id
        LEFT JOIN internal_permissions p ON p._id = rp.permission_id AND p._deleted = false AND p.status = 'active'
        ${whereSql}
        ORDER BY r.role_code ASC, p.permission_code ASC
      `,
      { replacements, type: QueryTypes.SELECT },
    );
  }
}
