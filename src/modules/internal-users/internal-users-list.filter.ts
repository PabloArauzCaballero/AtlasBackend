/**
 * @file Filtro del listado de usuarios internos: qué filas entran según búsqueda, estado y rol.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
import { Op, WhereOptions, literal } from 'sequelize';
import type { InternalUserModel } from '../../database/models/index.js';
import { PaginationInput, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';

const USER_ROLES = `${atlasSchemaFor('internal_user_roles')}.internal_user_roles`;
const ROLES = `${atlasSchemaFor('internal_roles')}.internal_roles`;

export type ListedUsers = { rows: InternalUserModel[]; total: number };

export type InternalUsersListFilter = {
  q?: string;
  status?: string;
  role?: string;
};

/**
 * Los usuarios que tienen HOY un rol vivo: asignación sin revocar sobre un rol activo y no borrado.
 * Es la misma regla con la que se arma su perfil de acceso (`getRolePermissionRowsForUsers`): un
 * rol revocado no se cuenta como suyo ni para el filtro ni para la búsqueda.
 */
const USERS_WITH_ROLE = (roleCondition: string) =>
  literal(`(
    SELECT ur.internal_user_id
      FROM ${USER_ROLES} ur
      JOIN ${ROLES} r ON r._id = ur.role_id AND r.status = 'active' AND r._deleted = false
     WHERE ur._tenant_id = :listTenantId AND ur.revoked_at IS NULL AND ${roleCondition}
  )`);

/**
 * El `WHERE` del listado y los valores que sus subconsultas necesitan.
 *
 * Antes el listado no aceptaba más que `page` y `limit`: la pantalla pedía la primera página (50) y
 * buscaba dentro de ella en el navegador, así que a partir del usuario 51 nadie aparecía en la
 * búsqueda. Ahora la búsqueda recorre la tabla entera por correo, nombre, departamento, cargo y los
 * códigos de los roles asignados, y el rol se filtra por asignación, no por la columna heredada.
 */
export function internalUsersListQuery(
  tenantId: string,
  filter: InternalUsersListFilter,
  pagination: PaginationInput,
): { where: WhereOptions; replacements: Record<string, string>; limit: number; offset: number } {
  const replacements: Record<string, string> = { listTenantId: tenantId };
  const and: WhereOptions[] = [{ tenantId }, { deleted: { [Op.ne]: true } }];
  if (filter.status) and.push({ status: filter.status });
  if (filter.role) {
    replacements.listRole = filter.role;
    and.push({ id: { [Op.in]: USERS_WITH_ROLE('r.role_code = :listRole') } });
  }
  const q = filter.q?.trim();
  if (q) {
    const pattern = containsLikePattern(q);
    replacements.listPattern = pattern;
    and.push({
      [Op.or]: [
        { email: { [Op.iLike]: pattern } },
        { fullName: { [Op.iLike]: pattern } },
        { department: { [Op.iLike]: pattern } },
        { jobTitle: { [Op.iLike]: pattern } },
        { id: { [Op.in]: USERS_WITH_ROLE('r.role_code ILIKE :listPattern') } },
      ],
    });
  }
  return { where: { [Op.and]: and }, replacements, limit: pagination.limit, offset: toOffset(pagination) };
}
