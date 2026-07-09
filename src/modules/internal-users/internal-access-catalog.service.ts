import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { InternalAccessCatalogRepository } from './internal-access-catalog.repository.js';
import { InternalPermissionListItem, InternalRoleCatalogRow, InternalRoleListItem } from './internal-access-catalog.types.js';

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))].sort();
}

function mapRowsToRoles(rows: InternalRoleCatalogRow[]): InternalRoleListItem[] {
  const byId = new Map<string, InternalRoleCatalogRow[]>();
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
  return [...byId.values()].map((roleRows) => {
    const first = roleRows[0];
    return {
      id: first.id,
      code: first.code,
      name: first.name,
      description: first.description,
      department: first.department,
      legacyRoleCode: first.legacyRoleCode,
      status: first.status,
      permissions: uniqueSorted(roleRows.map((row) => row.permissionCode)),
    };
  });
}

function assertInternalSession(currentUser: AuthenticatedUser): void {
  if (!currentUser.tenantId || !currentUser.internalUserId) throw new ForbiddenException('Esta operación requiere una sesión interna.');
}

@Injectable()
export class InternalAccessCatalogService {
  constructor(private readonly catalogRepository: InternalAccessCatalogRepository) {}

  async listRoles(currentUser: AuthenticatedUser): Promise<{ items: InternalRoleListItem[] }> {
    assertInternalSession(currentUser);
    return { items: mapRowsToRoles(await this.catalogRepository.listRoleRows()) };
  }

  async getRole(currentUser: AuthenticatedUser, roleId: string): Promise<InternalRoleListItem> {
    assertInternalSession(currentUser);
    const roles = mapRowsToRoles(await this.catalogRepository.findRoleRowsById(parsePositiveId(roleId, 'roleId')));
    if (roles.length === 0) throw new NotFoundException('Rol interno no encontrado.');
    return roles[0];
  }

  async listPermissions(currentUser: AuthenticatedUser): Promise<{ items: InternalPermissionListItem[] }> {
    assertInternalSession(currentUser);
    return { items: await this.catalogRepository.listPermissions() };
  }
}
