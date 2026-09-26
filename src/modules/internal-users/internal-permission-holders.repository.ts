/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza responde quién puede hacer algo, para poder enseñarlo antes de que lo haga.
 * @system consulta el catálogo RBAC al revés: de un permiso a las personas que lo tienen.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

/** Una fila de «quién tiene este permiso»: la persona, el rol que se lo da y el permiso concreto. */
export type InternalPermissionHolderRow = {
  internalUserId: string;
  fullName: string | null;
  email: string | null;
  status: string | null;
  department: string | null;
  jobTitle: string | null;
  roleCode: string;
  permissionCode: string;
};

/**
 * El catálogo RBAC leído al revés.
 *
 * `InternalRbacRepository` responde «qué puede esta persona», que es lo que necesita autorizar una
 * petición. Aquí se responde la contraria —«quién puede esto»—, que es lo que necesita una pantalla
 * que enseña quién ve un archivo antes de que nadie lo abra. Construirla con el repositorio de
 * siempre exigiría una consulta por empleado.
 *
 * Va en un archivo aparte y no dentro de `InternalRbacRepository` porque ese ya arrastra deuda de
 * tamaño congelada por `check:file-size`, y una consulta nueva no debe empeorarla.
 */
@Injectable()
export class InternalPermissionHoldersRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  /**
   * Todas las personas internas activas con ALGUNO de estos permisos por su rol.
   *
   * Devuelve una fila por (persona, rol, permiso); agruparlas es trabajo de quien llama, que es
   * quien sabe qué nivel da cada permiso en su dominio.
   */
  async findHolders(tenantId: string, permissionCodes: readonly string[]): Promise<InternalPermissionHolderRow[]> {
    if (permissionCodes.length === 0) return [];
    return this.sequelize.query<InternalPermissionHolderRow>(
      `
        SELECT u._id AS "internalUserId",
               u.full_name AS "fullName",
               u.email AS "email",
               u.status AS "status",
               u.department AS "department",
               u.job_title AS "jobTitle",
               r.role_code AS "roleCode",
               p.permission_code AS "permissionCode"
        FROM internal_users u
        JOIN internal_user_roles ur
          ON ur.internal_user_id = u._id
         AND ur._tenant_id = u._tenant_id
         AND ur.revoked_at IS NULL
        JOIN internal_roles r
          ON r._id = ur.role_id
         AND r.status = 'active'
         AND r._deleted = false
        JOIN internal_role_permissions rp
          ON rp.role_id = r._id
        JOIN internal_permissions p
          ON p._id = rp.permission_id
         AND p.status = 'active'
         AND p._deleted = false
        WHERE u._tenant_id = :tenantId
          AND COALESCE(u._deleted, false) = false
          AND p.permission_code IN (:permissionCodes)
        ORDER BY u.full_name ASC, u._id ASC, r.role_code ASC, p.permission_code ASC
      `,
      { replacements: { tenantId, permissionCodes: [...permissionCodes] }, type: QueryTypes.SELECT },
    );
  }
}
